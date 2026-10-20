namespace sap.xflights;

// Flight list in the shape of the classic xflights service (carrid, connid, fldate).
entity Flights {
  key carrid    : String(3);
  key connid    : String(4);
  key fldate    : Date;
      price     : Decimal(15, 2);
      currency  : String(3);
      planetype : String(10);
      seatsmax  : Integer;
      seatsocc  : Integer;
}
