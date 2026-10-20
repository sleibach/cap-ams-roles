"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cds = require("@sap/cds");
const constants_1 = require("./constants");
const hash_1 = require("./hash");
const principals_1 = require("./principals");
const sync_1 = require("./sync");
const LOG = cds.log('ams-roles');
const patched = Symbol('cap-ams-roles.patched');
function config() {
    const c = cds.env.requires['ams-roles'] ?? {};
    return {
        enabled: c.enabled !== false,
        principalTouchIntervalMs: Number(c.principalTouchInterval ?? 3600) * 1000,
        lockWait: Number(c.lockWait ?? 5),
        debounceMs: Number(c.debounceMs ?? 1000),
    };
}
let runtime;
let ams;
let assignments = null;
let dcn = '';
let fetchedAt = new Date(0);
let timer;
const subscribed = new WeakSet();
/** Resolve @sap/ams from the app, so a linked plugin patches the same copy CAP loaded. */
function loadAms(id) {
    const from = require.resolve(id, { paths: [cds.root, __dirname] });
    return require(from);
}
function amsRuntime() {
    runtime ??= loadAms('@sap/ams/src/cap/env/amsPluginRuntime.js');
    return runtime;
}
function instanceId() {
    return String(process.env.CF_INSTANCE_INDEX ?? '').slice(0, 10);
}
/** package.json `roles` stays an array; the runtime rewrites it to `{ Role: true }`. */
function roleList(roles) {
    if (Array.isArray(roles))
        return roles.map(String);
    if (roles && typeof roles === 'object') {
        return Object.entries(roles)
            .filter(([, granted]) => granted)
            .map(([role]) => role);
    }
    return [];
}
let configuredExtras;
function extraRoles() {
    if (!amsRuntime().mockedAuthActive)
        return [];
    // Read once. Later syncs must not pick up roles CAP copies onto the mocked user.
    if (configuredExtras)
        return configuredExtras;
    const users = (cds.env.requires.auth?.users ?? {});
    const mtx = Boolean(cds.env.requires.multitenancy);
    const out = [];
    for (const [name, user] of Object.entries(users)) {
        const tenant = mtx && user?.tenant ? String(user.tenant) : constants_1.UNDEFINED_TENANT;
        for (const role of roleList(user?.roles)) {
            if (!role || constants_1.PSEUDO_ROLES.includes(role.toLowerCase()))
                continue;
            out.push({ tenant, scimId: name, role });
        }
    }
    configuredExtras = out;
    return out;
}
function schedule() {
    if (timer)
        clearTimeout(timer);
    timer = setTimeout(() => {
        timer = undefined;
        void run().catch(err => LOG.error('sync failed', err));
    }, config().debounceMs);
    timer.unref?.();
}
async function run() {
    if (!ams || assignments == null)
        return;
    if (!ams.isReady())
        return;
    const snapshotAt = new Date(fetchedAt.getTime());
    const results = await (0, sync_1.syncSnapshot)({
        ams,
        assignments,
        dcnToken: dcn,
        fetchedAt: snapshotAt,
        extras: extraRoles(),
        linkPrincipals: amsRuntime().mockedAuthActive,
        dropMissing: true,
        lockWait: config().lockWait,
        instance: instanceId(),
    });
    for (const result of results) {
        if (result.skipped)
            LOG.debug('sync skipped', result);
        else
            LOG.info('synced AMS roles', result);
    }
}
function onAssignments(next) {
    assignments = next;
    fetchedAt = new Date();
    schedule();
}
function onDcn(payload) {
    dcn = (0, hash_1.dcnToken)(payload);
    fetchedAt = new Date();
    schedule();
}
function subscribe(instance) {
    const loader = instance?.bundleLoader;
    if (!loader || subscribed.has(loader))
        return;
    subscribed.add(loader);
    loader.on('assignmentsChanged', onAssignments);
    loader.on('dcnChanged', onDcn);
}
function patchStart(AuthorizationManagementService) {
    const orig = AuthorizationManagementService.prototype.start;
    if (orig[patched])
        return;
    function start() {
        ams = this;
        subscribe(this);
        return orig.call(this);
    }
    ;
    start[patched] = true;
    AuthorizationManagementService.prototype.start = start;
}
async function principalMiddleware(_req, _res, next) {
    try {
        const user = cds.context?.user;
        if (user)
            await (0, principals_1.rememberPrincipal)(user, config().principalTouchIntervalMs);
    }
    catch (err) {
        LOG.error('principal capture failed', err);
    }
    next();
}
function install() {
    const cmd = cds.cli?.command;
    if (cmd === 'build' || cmd === 'env')
        return;
    if (!config().enabled)
        return;
    let AuthorizationManagementService;
    try {
        AuthorizationManagementService = loadAms('@sap/ams/src/core/AuthorizationManagementService.js');
    }
    catch (err) {
        LOG.warn('@sap/ams is not installed, role mirror disabled', err);
        return;
    }
    patchStart(AuthorizationManagementService);
    cds.on('bootstrap', () => {
        try {
            ;
            cds.middlewares.add(principalMiddleware, { after: 'auth' });
        }
        catch (err) {
            LOG.error('could not register principal middleware', err);
        }
    });
    cds.on('served', async () => {
        try {
            const instance = amsRuntime().ams;
            ams = instance;
            subscribe(instance);
            await instance.whenReady(60);
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
            await run();
        }
        catch (err) {
            LOG.error('initial sync failed', err);
        }
    });
}
install();
