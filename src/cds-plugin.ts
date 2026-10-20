import cds = require('@sap/cds')
import { PSEUDO_ROLES, UNDEFINED_TENANT } from './constants'
import { dcnToken, type ExtraRole } from './hash'
import { rememberPrincipal, type PrincipalUser } from './principals'
import { type AmsLike } from './roles'
import { syncSnapshot } from './sync'

const LOG = cds.log('ams-roles')
const patched = Symbol('cap-ams-roles.patched')

interface PluginConfig {
  enabled: boolean
  principalTouchIntervalMs: number
  lockWait: number
  debounceMs: number
}

function config(): PluginConfig {
  const c = (cds.env.requires as { 'ams-roles'?: Record<string, unknown> })['ams-roles'] ?? {}
  return {
    enabled: c.enabled !== false,
    principalTouchIntervalMs: Number(c.principalTouchInterval ?? 3600) * 1000,
    lockWait: Number(c.lockWait ?? 5),
    debounceMs: Number(c.debounceMs ?? 1000),
  }
}

interface AmsRuntime {
  ams: AmsInstance
  mockedAuthActive: boolean
}

interface AmsInstance extends AmsLike {
  isReady(): boolean
  whenReady(timeoutSeconds?: number): Promise<void>
  bundleLoader: NodeJS.EventEmitter
  start(): void
}

let runtime: AmsRuntime | undefined
let ams: AmsInstance | undefined
let assignments: object | null = null
let dcn = ''
let fetchedAt = new Date(0)
let timer: NodeJS.Timeout | undefined
const subscribed = new WeakSet<object>()

/** Resolve @sap/ams from the app, so a linked plugin patches the same copy CAP loaded. */
function loadAms(id: string): any {
  const from = require.resolve(id, { paths: [cds.root, __dirname] })
  return require(from)
}

function amsRuntime(): AmsRuntime {
  runtime ??= loadAms('@sap/ams/src/cap/env/amsPluginRuntime.js') as AmsRuntime
  return runtime
}

function instanceId(): string {
  return String(process.env.CF_INSTANCE_INDEX ?? '').slice(0, 10)
}

/** package.json `roles` stays an array; the runtime rewrites it to `{ Role: true }`. */
function roleList(roles: unknown): string[] {
  if (Array.isArray(roles)) return roles.map(String)
  if (roles && typeof roles === 'object') {
    return Object.entries(roles as Record<string, unknown>)
      .filter(([, granted]) => granted)
      .map(([role]) => role)
  }
  return []
}

let configuredExtras: ExtraRole[] | undefined

function extraRoles(): ExtraRole[] {
  if (!amsRuntime().mockedAuthActive) return []
  // Read once. Later syncs must not pick up roles CAP copies onto the mocked user.
  if (configuredExtras) return configuredExtras
  const users = (cds.env.requires.auth?.users ?? {}) as Record<string, { tenant?: string; roles?: unknown }>
  const mtx = Boolean((cds.env.requires as { multitenancy?: unknown }).multitenancy)
  const out: ExtraRole[] = []
  for (const [name, user] of Object.entries(users)) {
    const tenant = mtx && user?.tenant ? String(user.tenant) : UNDEFINED_TENANT
    for (const role of roleList(user?.roles)) {
      if (!role || PSEUDO_ROLES.includes(role.toLowerCase())) continue
      out.push({ tenant, scimId: name, role })
    }
  }
  configuredExtras = out
  return out
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void run().catch(err => LOG.error('sync failed', err))
  }, config().debounceMs)
  timer.unref?.()
}

async function run(): Promise<void> {
  if (!ams || assignments == null) return
  if (!ams.isReady()) return
  const snapshotAt = new Date(fetchedAt.getTime())
  const results = await syncSnapshot({
    ams,
    assignments,
    dcnToken: dcn,
    fetchedAt: snapshotAt,
    extras: extraRoles(),
    linkPrincipals: amsRuntime().mockedAuthActive,
    dropMissing: true,
    lockWait: config().lockWait,
    instance: instanceId(),
  })
  for (const result of results) {
    if (result.skipped) LOG.debug('sync skipped', result)
    else LOG.info('synced AMS roles', result)
  }
}

function onAssignments(next: object): void {
  assignments = next
  fetchedAt = new Date()
  schedule()
}

function onDcn(payload: unknown): void {
  dcn = dcnToken(payload)
  fetchedAt = new Date()
  schedule()
}

function subscribe(instance: AmsInstance): void {
  const loader = instance?.bundleLoader
  if (!loader || subscribed.has(loader)) return
  subscribed.add(loader)
  loader.on('assignmentsChanged', onAssignments)
  loader.on('dcnChanged', onDcn)
}

function patchStart(AuthorizationManagementService: { prototype: { start: AmsInstance['start'] } }): void {
  const orig = AuthorizationManagementService.prototype.start
  if ((orig as unknown as Record<symbol, boolean>)[patched]) return
  function start(this: AmsInstance) {
    ams = this
    subscribe(this)
    return orig.call(this)
  }
  ;(start as unknown as Record<symbol, boolean>)[patched] = true
  AuthorizationManagementService.prototype.start = start as AmsInstance['start']
}

async function principalMiddleware(_req: unknown, _res: unknown, next: (err?: unknown) => void): Promise<void> {
  try {
    const user = cds.context?.user as PrincipalUser | undefined
    if (user) await rememberPrincipal(user, config().principalTouchIntervalMs)
  } catch (err) {
    LOG.error('principal capture failed', err)
  }
  next()
}

function install(): void {
  const cmd = (cds as unknown as { cli?: { command?: string } }).cli?.command
  if (cmd === 'build' || cmd === 'env') return
  if (!config().enabled) return

  let AuthorizationManagementService: { prototype: { start: AmsInstance['start'] } }
  try {
    AuthorizationManagementService = loadAms('@sap/ams/src/core/AuthorizationManagementService.js')
  } catch (err) {
    LOG.warn('@sap/ams is not installed, role mirror disabled', err)
    return
  }
  patchStart(AuthorizationManagementService)

  cds.on('bootstrap', () => {
    try {
      ;(cds as unknown as { middlewares: { add: Function } }).middlewares.add(principalMiddleware, { after: 'auth' })
    } catch (err) {
      LOG.error('could not register principal middleware', err)
    }
  })

  cds.on('served', async () => {
    try {
      const instance = amsRuntime().ams
      ams = instance
      subscribe(instance)
      await instance.whenReady(60)
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      await run()
    } catch (err) {
      LOG.error('initial sync failed', err)
    }
  })
}

install()
