"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flattenAssignments = flattenAssignments;
exports.stableStringify = stableStringify;
exports.snapshotHash = snapshotHash;
exports.dcnToken = dcnToken;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
/**
 * AMS keys mocked assignments with a Symbol (CDS_UNDEFINED_TENANT).
 * String keys are application tenant ids from the bundle.
 */
function flattenAssignments(raw) {
    if (raw == null)
        return [];
    const out = [];
    const keys = [
        ...Object.getOwnPropertyNames(raw),
        ...Object.getOwnPropertySymbols(raw),
    ];
    for (const key of keys) {
        const tenant = typeof key === 'symbol' ? constants_1.UNDEFINED_TENANT : String(key);
        const users = raw[key] ?? {};
        for (const scimId of Object.keys(users)) {
            const value = users[scimId];
            const policies = [...(Array.isArray(value) ? value : [])].map(String).filter(Boolean).sort();
            out.push({ tenant, scimId, policies });
        }
    }
    out.sort((a, b) => a.tenant.localeCompare(b.tenant) || a.scimId.localeCompare(b.scimId));
    return out;
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return '[' + value.map(stableStringify).join(',') + ']';
    const obj = value;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
/** Content hash of one tenant's assignments, the DCN, and mocked extra roles. */
function snapshotHash(parts) {
    const extras = parts.extras
        .map(e => ({ tenant: e.tenant, scimId: e.scimId, role: e.role }))
        .sort((a, b) => a.tenant.localeCompare(b.tenant) || a.scimId.localeCompare(b.scimId) || a.role.localeCompare(b.role));
    return (0, node_crypto_1.createHash)('sha256').update(stableStringify({
        assignments: parts.assignments,
        dcnToken: parts.dcnToken,
        extras,
    })).digest('hex');
}
/**
 * Hash the policy/schema/function part of a bundle.
 * `manifest.build_time` changes on every local load and must not force a rewrite.
 */
function dcnToken(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    return (0, node_crypto_1.createHash)('sha256').update(stableStringify({
        policies: body.policies ?? [],
        schemas: body.schemas ?? [],
        functions: body.functions ?? [],
    })).digest('hex');
}
