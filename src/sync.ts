import cds = require('@sap/cds')
import { PRINCIPALS, SYNC_STATE, UNDEFINED_TENANT, USER_POLICIES, USER_ROLES } from './constants'
import { type ExtraRole, type FlatAssignment, flattenAssignments, snapshotHash } from './hash'
import { type AmsLike, deriveRoles } from './roles'

export interface SyncOptions {
  ams: AmsLike
  /** Raw `principal2policies` map. Symbol keys are the mocked undefined tenant. */
  assignments: object
  dcnToken: string
  fetchedAt: Date
  extras?: ExtraRole[]
  /** Mocked mode: scim id is the CAP user id, so principals can be seeded here. */
  linkPrincipals?: boolean
  /** Clear tenants that were synced before and are absent from this bundle. The plugin sets this; partial callers must not. */
  dropMissing?: boolean
  lockWait?: number
  instance?: string
}

export interface SyncResult {
  tenant: string
  skipped?: 'hash' | 'stale' | 'lock'
  policies?: number
  roles?: number
}

const queues = new Map<string, Promise<unknown>>()

function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(() => fn(), () => fn())
  queues.set(key, next)
  return next
}

function timeMs(value: unknown): number {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  const n = new Date(String(value)).getTime()
  return Number.isFinite(n) ? n : 0
}

function isLockTimeout(err: unknown): boolean {
  const e = err as { message?: string; code?: unknown }
  const msg = String(e?.message ?? err)
  return /lock (?:wait|acquire) timeout|timed? out while waiting|resource busy/i.test(msg)
    || e?.code === 131
    || e?.code === 146
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { message?: string; code?: unknown }
  const msg = String(e?.message ?? err)
  return /unique constraint/i.test(msg) || e?.code === 301
}

interface RoleRow { scimId: string; role: string; conditional: boolean }
interface PolicyRow { scimId: string; policy: string }

function group<T extends { scimId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.scimId)
    if (list) list.push(row)
    else map.set(row.scimId, [row])
  }
  return map
}

function samePolicies(current: PolicyRow[], desired: string[]): boolean {
  if (current.length !== desired.length) return false
  const have = new Set(current.map(r => r.policy))
  return desired.every(p => have.has(p))
}

function sameRoles(current: { role: string; conditional: unknown }[], desired: { role: string; conditional: boolean }[]): boolean {
  if (current.length !== desired.length) return false
  const have = new Map(current.map(r => [r.role, Boolean(r.conditional)]))
  return desired.every(r => have.get(r.role) === r.conditional)
}

/**
 * Diff-write one tenant. Callers serialize per tenant; the DB lock serializes across processes.
 * A hash match still advances `fetchedAt` when the incoming bundle is newer, so an older
 * instance cannot later overwrite with a different snapshot from between the two.
 */
async function writeTenant(tenant: string, flat: FlatAssignment[], opts: SyncOptions): Promise<SyncResult> {
  const extras = (opts.extras ?? []).filter(e => e.tenant === tenant)
  const hash = snapshotHash({ assignments: flat, dcnToken: opts.dcnToken, extras })
  const lockWait = opts.lockWait ?? 5
  const instance = (opts.instance ?? '').slice(0, 10)
  const { SELECT, INSERT, UPDATE, DELETE, UPSERT } = cds.ql

  let state = await SELECT.one.from(SYNC_STATE).where({ tenant }).forUpdate({ wait: lockWait })
  if (!state) {
    await INSERT.into(SYNC_STATE).entries({
      tenant,
      hash: '',
      fetchedAt: new Date(0),
      syncedAt: new Date(0),
      instance,
    })
    state = { hash: '', fetchedAt: new Date(0) }
  }

  if (state.hash === hash) {
    if (timeMs(opts.fetchedAt) > timeMs(state.fetchedAt)) {
      await UPDATE(SYNC_STATE).set({
        fetchedAt: opts.fetchedAt,
        syncedAt: new Date(),
        instance,
      }).where({ tenant })
    }
    return { tenant, skipped: 'hash' }
  }
  if (timeMs(state.fetchedAt) >= timeMs(opts.fetchedAt)) {
    return { tenant, skipped: 'stale' }
  }

  const memo = new Map()
  const desiredPolicies: PolicyRow[] = []
  const desiredRoles: RoleRow[] = []
  const amsTenant = tenant === UNDEFINED_TENANT ? undefined : tenant

  for (const assignment of flat) {
    for (const policy of assignment.policies) {
      desiredPolicies.push({ scimId: assignment.scimId, policy })
    }
    const derived = await deriveRoles(opts.ams, amsTenant, assignment.policies, memo)
    for (const role of derived) {
      desiredRoles.push({ scimId: assignment.scimId, role: role.role, conditional: role.conditional })
    }
  }
  for (const extra of extras) {
    if (desiredRoles.some(r => r.scimId === extra.scimId && r.role === extra.role)) continue
    desiredRoles.push({ scimId: extra.scimId, role: extra.role, conditional: false })
  }

  const currentPolicies = await SELECT.from(USER_POLICIES).columns('scimId', 'policy').where({ tenant }) as PolicyRow[]
  const currentRoles = await SELECT.from(USER_ROLES).columns('scimId', 'role', 'conditional').where({ tenant }) as RoleRow[]
  const policiesByUser = group(currentPolicies)
  const rolesByUser = group(currentRoles)
  const desiredPolicyByUser = group(desiredPolicies)
  const desiredRoleByUser = group(desiredRoles)

  const ids = new Set<string>([
    ...policiesByUser.keys(),
    ...rolesByUser.keys(),
    ...desiredPolicyByUser.keys(),
    ...desiredRoleByUser.keys(),
  ])
  const changed: string[] = []
  for (const scimId of ids) {
    const wantPolicies = (desiredPolicyByUser.get(scimId) ?? []).map(r => r.policy)
    const wantRoles = desiredRoleByUser.get(scimId) ?? []
    if (samePolicies(policiesByUser.get(scimId) ?? [], wantPolicies)
      && sameRoles(rolesByUser.get(scimId) ?? [], wantRoles)) continue
    changed.push(scimId)
  }

  if (changed.length) {
    await DELETE.from(USER_POLICIES).where({ tenant, scimId: { in: changed } })
    await DELETE.from(USER_ROLES).where({ tenant, scimId: { in: changed } })
    const policyEntries = desiredPolicies
      .filter(r => changed.includes(r.scimId))
      .map(r => ({ tenant, scimId: r.scimId, policy: r.policy }))
    const roleEntries = desiredRoles
      .filter(r => changed.includes(r.scimId))
      .map(r => ({ tenant, scimId: r.scimId, role: r.role, conditional: r.conditional }))
    if (policyEntries.length) await INSERT.into(USER_POLICIES).entries(policyEntries)
    if (roleEntries.length) await INSERT.into(USER_ROLES).entries(roleEntries)
  }

  if (opts.linkPrincipals) {
    const principalIds = new Set<string>([...flat.map(a => a.scimId), ...extras.map(e => e.scimId)])
    if (principalIds.size) {
      await UPSERT.into(PRINCIPALS).entries([...principalIds].map(scimId => ({
        tenant,
        scimId,
        userId: scimId,
        lastSeen: new Date(),
      })))
    }
  }

  await UPDATE(SYNC_STATE).set({
    hash,
    fetchedAt: opts.fetchedAt,
    syncedAt: new Date(),
    instance,
  }).where({ tenant })

  return { tenant, policies: desiredPolicies.length, roles: desiredRoles.length }
}

async function syncTenant(tenant: string, flat: FlatAssignment[], opts: SyncOptions, attempt = 0): Promise<SyncResult> {
  try {
    return await cds.tx(() => writeTenant(tenant, flat, opts))
  } catch (err) {
    if (isLockTimeout(err)) {
      cds.log('ams-roles').debug('sync skipped, another instance holds the lock', tenant)
      return { tenant, skipped: 'lock' }
    }
    if (isUniqueViolation(err) && attempt < 1) return syncTenant(tenant, flat, opts, attempt + 1)
    throw err
  }
}

export async function syncSnapshot(opts: SyncOptions): Promise<SyncResult[]> {
  const flat = flattenAssignments(opts.assignments)
  const extras = opts.extras ?? []
  const tenants = new Set<string>([...flat.map(a => a.tenant), ...extras.map(e => e.tenant)])

  // A tenant that disappeared from the bundle must be cleared, not left behind.
  if (opts.dropMissing) {
    const { SELECT } = cds.ql
    const stored = await SELECT.from(SYNC_STATE).columns('tenant') as { tenant: string }[]
    for (const row of stored) tenants.add(row.tenant)
  }

  const results: SyncResult[] = []
  for (const tenant of tenants) {
    const slice = flat.filter(a => a.tenant === tenant)
    results.push(await exclusive(tenant, () => syncTenant(tenant, slice, opts)))
  }
  return results
}
