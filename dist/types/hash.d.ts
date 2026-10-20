export interface FlatAssignment {
    tenant: string;
    scimId: string;
    policies: string[];
}
export interface ExtraRole {
    tenant: string;
    scimId: string;
    role: string;
}
/**
 * AMS keys mocked assignments with a Symbol (CDS_UNDEFINED_TENANT).
 * String keys are application tenant ids from the bundle.
 */
export declare function flattenAssignments(raw: object | null | undefined): FlatAssignment[];
export declare function stableStringify(value: unknown): string;
/** Content hash of one tenant's assignments, the DCN, and mocked extra roles. */
export declare function snapshotHash(parts: {
    assignments: FlatAssignment[];
    dcnToken: string;
    extras: ExtraRole[];
}): string;
/**
 * Hash the policy/schema/function part of a bundle.
 * `manifest.build_time` changes on every local load and must not force a rewrite.
 */
export declare function dcnToken(payload: unknown): string;
