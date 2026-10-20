/** Stored tenant key when AMS uses the mocked "no CAP tenant" symbol. */
export const UNDEFINED_TENANT = 'undefined'

/** CAP rejects these if a policy tries to grant them. Mirror the AMS filter. */
export const PSEUDO_ROLES = ['any', 'authenticated-user', 'internal-user', 'system-user']

export const SCOPE_RESOURCE = '$SCOPES'

export const PRINCIPALS = 'sap.ams.mirror.Principals'
export const USER_POLICIES = 'sap.ams.mirror.UserPolicies'
export const USER_ROLES = 'sap.ams.mirror.UserRoles'
export const SYNC_STATE = 'sap.ams.mirror.SyncState'
