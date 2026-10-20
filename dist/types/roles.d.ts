export interface DerivedRole {
    role: string;
    conditional: boolean;
}
export interface AmsAuthorizations {
    getPotentialActions(resource: string): Iterable<string>;
    checkPrivilege(action: string, resource: string): {
        isGranted(): boolean;
    };
}
export interface AmsLike {
    getAuthorizations(policySet: {
        policies: string[];
        tenant?: string;
        includeDefaultPolicies?: boolean;
    }): Promise<AmsAuthorizations>;
}
/**
 * CAP roles granted by a policy set. Same call the AMS CAP middleware makes:
 * getAuthorizations(...).getPotentialActions('$SCOPES'), minus pseudo roles.
 * `conditional` is set when the grant still depends on an attribute condition.
 * Memoized per sync, because many users share one policy set.
 */
export declare function deriveRoles(ams: AmsLike, tenant: string | undefined, policies: string[], memo: Map<string, DerivedRole[]>): Promise<DerivedRole[]>;
