"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYNC_STATE = exports.USER_ROLES = exports.USER_POLICIES = exports.PRINCIPALS = exports.SCOPE_RESOURCE = exports.PSEUDO_ROLES = exports.UNDEFINED_TENANT = void 0;
/** Stored tenant key when AMS uses the mocked "no CAP tenant" symbol. */
exports.UNDEFINED_TENANT = 'undefined';
/** CAP rejects these if a policy tries to grant them. Mirror the AMS filter. */
exports.PSEUDO_ROLES = ['any', 'authenticated-user', 'internal-user', 'system-user'];
exports.SCOPE_RESOURCE = '$SCOPES';
exports.PRINCIPALS = 'sap.ams.mirror.Principals';
exports.USER_POLICIES = 'sap.ams.mirror.UserPolicies';
exports.USER_ROLES = 'sap.ams.mirror.UserRoles';
exports.SYNC_STATE = 'sap.ams.mirror.SyncState';
