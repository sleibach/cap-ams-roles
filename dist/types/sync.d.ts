import { type ExtraRole } from './hash';
import { type AmsLike } from './roles';
export interface SyncOptions {
    ams: AmsLike;
    /** Raw `principal2policies` map. Symbol keys are the mocked undefined tenant. */
    assignments: object;
    dcnToken: string;
    fetchedAt: Date;
    extras?: ExtraRole[];
    /** Mocked mode: scim id is the CAP user id, so principals can be seeded here. */
    linkPrincipals?: boolean;
    /** Clear tenants that were synced before and are absent from this bundle. The plugin sets this; partial callers must not. */
    dropMissing?: boolean;
    lockWait?: number;
    instance?: string;
}
export interface SyncResult {
    tenant: string;
    skipped?: 'hash' | 'stale' | 'lock';
    policies?: number;
    roles?: number;
}
export declare function syncSnapshot(opts: SyncOptions): Promise<SyncResult[]>;
