POLICY "BookingAgent" {
  ASSIGN ROLE "BookingAgent";
}

POLICY "Viewer" {
  ASSIGN ROLE "Viewer";
}

POLICY "RegionalAgent" {
  ASSIGN ROLE "BookingAgent" WHERE Airline = 'LH';
}
