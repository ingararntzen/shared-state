# Server Clock & Time Synchronization

> - SharedState includes a built-in network clock synchronization protocol (`/clock`).
> - Enables time-consistent media playback and synchronized event execution across clients.

For clock API usage, see [ServerClock API](/client-api/server-clock.md).

---

## The Clock Drift Problem

In real-time collaborative applications (e.g. shared video/audio playback, collaborative canvas editing, or timestamped logging), client device clocks often drift or sync coarsely. Relying on local client timestamps leads to inconsistent playback and event ordering errors.

---

## ServerClock Solution

SharedState provides an integrated server clock protocol:

* **Protocol Endpoint**: `GET /clock` returns the current UTC timestamp on the server.
* **`ServerClock` Helper**: Measures round-trip time (RTT) and calculates offset between local system time and server UTC time.

---

## Time-Consistent Playback

Applications can stamp item states with server-synchronized timestamps. Upon receiving updates, clients schedule rendering according to server clock time rather than packet arrival time, guaranteeing jitter-free, synchronized execution across all connected devices.
