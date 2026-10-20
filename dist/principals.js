"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rememberPrincipal = rememberPrincipal;
exports.resetPrincipalCache = resetPrincipalCache;
const cds = require("@sap/cds");
const constants_1 = require("./constants");
const seen = new Map();
function asId(value) {
    if (typeof value !== 'string')
        return undefined;
    const id = value.trim();
    return id || undefined;
}
/**
 * Remember sub <-> scim_id. Writes only when the pair is new to this process,
 * or the last write is older than `intervalMs`. Failures are the caller's to log.
 */
async function rememberPrincipal(user, intervalMs) {
    const token = user?.authInfo?.token;
    const scimId = asId(token?.scimId) ?? asId(token?.payload?.scim_id);
    const userId = asId(user?.id);
    if (!scimId || !userId || userId === 'anonymous' || userId === 'system')
        return false;
    const rawTid = token?.appTid ?? token?.payload?.app_tid;
    const tenant = asId(rawTid) ?? constants_1.UNDEFINED_TENANT;
    const key = tenant + '|' + scimId + '|' + userId;
    const now = Date.now();
    const prev = seen.get(key);
    if (prev != null && now - prev < intervalMs)
        return false;
    seen.set(key, now);
    try {
        const { UPSERT } = cds.ql;
        await cds.tx(async () => {
            await UPSERT.into(constants_1.PRINCIPALS).entries({
                tenant,
                scimId,
                userId,
                lastSeen: new Date(now),
            });
        });
        return true;
    }
    catch (err) {
        seen.delete(key);
        throw err;
    }
}
/** Test hook. */
function resetPrincipalCache() {
    seen.clear();
}
