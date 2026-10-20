"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveRoles = deriveRoles;
const constants_1 = require("./constants");
/**
 * CAP roles granted by a policy set. Same call the AMS CAP middleware makes:
 * getAuthorizations(...).getPotentialActions('$SCOPES'), minus pseudo roles.
 * `conditional` is set when the grant still depends on an attribute condition.
 * Memoized per sync, because many users share one policy set.
 */
async function deriveRoles(ams, tenant, policies, memo) {
    const sorted = [...policies].sort();
    const key = (tenant ?? '') + '\0' + sorted.join('\0');
    const hit = memo.get(key);
    if (hit)
        return hit;
    const authz = await ams.getAuthorizations({
        policies: sorted,
        tenant,
        includeDefaultPolicies: true,
    });
    const roles = [];
    for (const action of authz.getPotentialActions(constants_1.SCOPE_RESOURCE)) {
        const role = String(action);
        if (constants_1.PSEUDO_ROLES.includes(role.toLowerCase()))
            continue;
        const unconditional = authz.checkPrivilege(role, constants_1.SCOPE_RESOURCE).isGranted();
        roles.push({ role, conditional: !unconditional });
    }
    roles.sort((a, b) => a.role.localeCompare(b.role));
    memo.set(key, roles);
    return roles;
}
