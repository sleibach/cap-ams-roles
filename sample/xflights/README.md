# xflights

Small stand-in for the classic xflights service. `hideBook` is true unless the current user has the `BookingAgent` role, joined from the AMS mirror.

```bash
npm install
npm run watch
```

Mocked users:

| User | Policies | Extra CAP roles | `hideBook` |
| --- | --- | --- | --- |
| alice | `cap.BookingAgent` | `DutyManager` | false |
| bob | `cap.Viewer` | | true |
| carol | `cap.RegionalAgent` (BookingAgent where Airline = LH) | | false |

`GET /flights/Flights` as alice or bob (basic auth, empty password).
