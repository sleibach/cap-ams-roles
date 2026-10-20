export interface PrincipalUser {
    id?: string;
    authInfo?: {
        token?: {
            scimId?: unknown;
            appTid?: unknown;
            payload?: {
                scim_id?: unknown;
                app_tid?: unknown;
            };
        };
    };
}
/**
 * Remember sub <-> scim_id. Writes only when the pair is new to this process,
 * or the last write is older than `intervalMs`. Failures are the caller's to log.
 */
export declare function rememberPrincipal(user: PrincipalUser | undefined, intervalMs: number): Promise<boolean>;
/** Test hook. */
export declare function resetPrincipalCache(): void;
