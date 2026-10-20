import { createHash } from 'node:crypto'
import { UNDEFINED_TENANT } from './constants'

export interface FlatAssignment {
  tenant: string
  scimId: string
  policies: string[]
}

export interface ExtraRole {
  tenant: string
  scimId: string
  role: string
}

/**
 * AMS keys mocked assignments with a Symbol (CDS_UNDEFINED_TENANT).
 * String keys are application tenant ids from the bundle.
 */
export function flattenAssignments(raw: object | null | undefined): FlatAssignment[] {
  if (raw == null) return []
  const out: FlatAssignment[] = []
  const keys = [
    ...Object.getOwnPropertyNames(raw),
    ...Object.getOwnPropertySymbols(raw),
  ]
  for (const key of keys) {
    const tenant = typeof key === 'symbol' ? UNDEFINED_TENANT : String(key)
    const users = (raw as Record<PropertyKey, Record<string, unknown>>)[key] ?? {}
    for (const scimId of Object.keys(users)) {
      const value = users[scimId]
      const policies = [...(Array.isArray(value) ? value : [])].map(String).filter(Boolean).sort()
      out.push({ tenant, scimId, policies })
    }
  }
  out.sort((a, b) => a.tenant.localeCompare(b.tenant) || a.scimId.localeCompare(b.scimId))
  return out
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

/** Content hash of one tenant's assignments, the DCN, and mocked extra roles. */
export function snapshotHash(parts: {
  assignments: FlatAssignment[]
  dcnToken: string
  extras: ExtraRole[]
}): string {
  const extras = parts.extras
    .map(e => ({ tenant: e.tenant, scimId: e.scimId, role: e.role }))
    .sort((a, b) => a.tenant.localeCompare(b.tenant) || a.scimId.localeCompare(b.scimId) || a.role.localeCompare(b.role))
  return createHash('sha256').update(stableStringify({
    assignments: parts.assignments,
    dcnToken: parts.dcnToken,
    extras,
  })).digest('hex')
}

/**
 * Hash the policy/schema/function part of a bundle.
 * `manifest.build_time` changes on every local load and must not force a rewrite.
 */
export function dcnToken(payload: unknown): string {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  return createHash('sha256').update(stableStringify({
    policies: body.policies ?? [],
    schemas: body.schemas ?? [],
    functions: body.functions ?? [],
  })).digest('hex')
}
