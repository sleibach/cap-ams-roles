# cap-ams-roles

CDS plugin that copies the AMS authorization bundle into tables, so a CDS model can join on the current user's roles.

AMS keeps assignments in memory on every app instance and polls the bundle about every 20 seconds. This plugin writes that snapshot to the database. Several instances can refresh at different times. A sync takes a row lock on `SyncState`, skips a snapshot it has already written, and skips one that is older than the row it holds. The same content still moves `fetchedAt` forward, so a late older bundle cannot overwrite it.

The mirror is for display flags and joins. It lags by about one poll plus the sync. Access checks stay on AMS (`@requires`). Do not authorize from these tables.

## Install

```json
"dependencies": {
  "cap-ams-roles": "https://github.com/sleibach/cap-ams-roles.git",
  "@sap/ams": "^3"
}
```

The plugin adds `sap.ams.mirror`. Configuration lives under `cds.requires.ams-roles`:

| Property | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Turn the mirror off |
| `principalTouchInterval` | `3600` | Seconds before a known user id is written again |
| `lockWait` | `5` | Seconds to wait for the sync lock |
| `debounceMs` | `1000` | Wait for the policy and DCN events of one bundle |

`CF_INSTANCE_INDEX` is stored on the sync row so you can see which instance wrote last.

## Joining the current user

AMS keys assignments by `scim_id`. CAP's `$user.id` is the IAS `sub`. The plugin stores that pair in `Principals` on the first request (mocked users are seeded immediately, because the two ids are the same). Until that row exists, a join for an IAS user is empty.

Put the association and the calculated flag on **separate** projections. In one projection the compiler reports `Element "myRoles" has not been found`.

```cds
using { sap.ams.mirror as ams } from 'cap-ams-roles/db/ams-roles';

entity FlightsForUser as projection on Flights {
  *,
  myRoles : Association to many ams.RolesByUser on myRoles.userId = $user.id,
};

entity Flights as projection on FlightsForUser {
  *,
  (case when exists myRoles[role = 'BookingAgent'] then false else true end) as hideBook : Boolean,
};
```

`$user.id` compiles to `session_context('$user.id')`. HANA and the SQLite adapter both provide that. `UserRoles.conditional` is true when the grant still depends on an AMS attribute condition.

## Sample

[sample/xflights](sample/xflights) is a small xflights service (`carrid`, `connid`, `fldate`) with `hideBook`. Alice can book, Bob cannot.

```bash
npm install
npm test
npm run sample
```

## Limits

- Single CAP database. The `tenant` column is the AMS application tenant id, not a CAP tenant. Multitenant database routing is not implemented.
- An IAS user can be joined only after this instance has seen a request from them.
- Mocked `users.*.roles` are merged in. Those roles never come from a policy. CAP stores that list as `{ Role: true }` after startup; the plugin accepts both shapes.
- Role derivation uses `includeDefaultPolicies`, same as the AMS CAP middleware. Built-in roles such as `cds.ExtensionDeveloper` can show up next to the roles from the assigned policies.
- `SELECT FOR UPDATE` is a no-op on SQLite. One process still serializes its own writers. Across processes the lock matters on HANA (`HANA_TEST=1`).
