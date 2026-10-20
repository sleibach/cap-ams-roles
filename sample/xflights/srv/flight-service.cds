using { sap.xflights as db } from '../db/schema';
using { sap.ams.mirror as ams } from 'cap-ams-roles/db/ams-roles';

// Association and calculated flag have to be on separate projections.
// A calc in the same projection cannot see the association just declared there.
entity sap.xflights.FlightsForUser as projection on db.Flights {
  *,
  myRoles : Association to many ams.RolesByUser on myRoles.userId = $user.id,
};

@path : '/flights'
service FlightService {
  @readonly
  entity Flights as projection on sap.xflights.FlightsForUser {
    *,
    // BookingAgent may book. Viewers see the flight but not the action.
    (case when exists myRoles[role = 'BookingAgent'] then false else true end) as hideBook : Boolean,
  }
  actions {
    action book();
  };
}

annotate FlightService with @requires: [
  'Viewer',
  'BookingAgent',
];

annotate FlightService.Flights actions {
  book @requires: 'BookingAgent';
};
