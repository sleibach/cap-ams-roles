namespace sap.ams.mirror;

// sub <-> scim_id, filled when a user is seen (and for every mocked user at sync).
// @cds.persistence.journal: keep rows across schema upgrades; they are rebuilt from AMS anyway,
// but a drop would hide joined flags until the next request.
@cds.persistence.journal
entity Principals {
  key tenant   : String(36);
  key scimId   : String(36);
      userId   : String(255);
      lastSeen : Timestamp;
}

entity UserPolicies {
  key tenant : String(36);
  key scimId : String(36);
  key policy : String(255);
}

entity UserRoles {
  key tenant      : String(36);
  key scimId      : String(36);
  key role        : String(255);
      conditional : Boolean;
}

// One row per AMS application tenant. Locked with SELECT FOR UPDATE while a sync writes.
entity SyncState {
  key tenant    : String(36);
      hash      : String(64);
      fetchedAt : Timestamp;
      syncedAt  : Timestamp;
      instance  : String(10);
}

// Join by the CAP user id (IAS sub, or the mocked user name).
view RolesByUser as select from UserRoles as r
  inner join Principals as p
    on p.tenant = r.tenant
   and p.scimId = r.scimId
{
  key p.userId,
  key r.role,
      r.conditional,
      r.tenant
};
