import { PSEUDO_ROLES, SCOPE_RESOURCE } from './constants'

export interface DerivedRole {
  role: string
  conditional: boolean
}

export interface AmsAuthorizations {
  getPotentialActions(resource: string): Iterable<string>
  checkPrivilege(action: string, resource: string): { isGranted(): boolean }
}

export interface AmsLike {
  getAuthorizations(policySet: {
    policies: string[]
    tenant?: string
    includeDefaultPolicies?: boolean
  }): Promise<AmsAuthorizations>
}

/**
 * CAP roles granted by a policy set. Same call the AMS CAP middleware makes:
 * getAuthorizations(...).getPotentialActions('$SCOPES'), minus pseudo roles.
 * `conditional` is set when the grant still depends on an attribute condition.
 * Memoized per sync, because many users share one policy set.
 */
export async function deriveRoles(
  ams: AmsLike,
  tenant: string | undefined,
  policies: string[],
  memo: Map<string, DerivedRole[]>,
): Promise<DerivedRole[]> {
  const sorted = [...policies].sort()
  const key = (tenant ?? '') + '\0' + sorted.join('\0')
  const hit = memo.get(key)
  if (hit) return hit

  const authz = await ams.getAuthorizations({
    policies: sorted,
    tenant,
    includeDefaultPolicies: true,
  })

  const roles: DerivedRole[] = []
  for (const action of authz.getPotentialActions(SCOPE_RESOURCE)) {
    const role = String(action)
    if (PSEUDO_ROLES.includes(role.toLowerCase())) continue
    const unconditional = authz.checkPrivilege(role, SCOPE_RESOURCE).isGranted()
    roles.push({ role, conditional: !unconditional })
  }
  roles.sort((a, b) => a.role.localeCompare(b.role))
  memo.set(key, roles)
  return roles
}
