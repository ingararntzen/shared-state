[SharedState Client]: /design/overview#sharedstate-client
[SharedState Server]: /design/overview#sharedstate-server

# Clock

> The SharedState client provides a local clock synchronized to the clock of the SharedState server.


---


## Client-side Server Clock

The estimated server clock is available as a property `server_clock` on the SharedState client. This highlights that clocks can also be regarded as shared state in an application.

```javascript
// Local timestamp and server timestamp 
const local_time = ss_client.local_clock.now();
const server_time = ss_client.server_clock.now();
// Current estimates for clock skew and network rtt.
// Server clock is local clock + estimated skew
const skew = ss_client.server_clock.skew;
const rtt = ss_client.server_clock.rtt;
```

---
## Clock Sampling

Clock estimation is based on repeated sampling of round-trip times (RTT) and server clock readings. Measurements are conducted by requesting clock readings (`GET /clock`) from the server.


```javascript
// ts0: local time when request sent
// ts1: server time when request processed
// ts2: local time when reply received
const ts0 = client.local_clock.now();
const samples = [];
client.get("/clock").then(({ok, ts1}) => {
    if (ok) {
        const ts2 = client.local_clock.now();
        samples.push([ts0, ts1, ts2]);    
    }
});

```
- Sampling is fast paced initially after connection has been established, then slows down, ultimately stabilising at 1 sample per 10 seconds.
- When the connection is disconnected, active sampling stops, implying that there will be no further adjustments to the estimate, until the connection is re-established.

---
## Clock Integrity

Both client and server clocks are protected against adjustments to the system clock, which may for example be the effect of clock synchronization protocols (i.e., NTP, PTP), manual configuration, or virtual machine operations (VM pause/resume). 

- The SharedState server clock implements a *slewed clock*. This ensures that: 
    - It will remain a close approximation of UTC time, even if the server has been running for a long time.
    - It stays monontoic.
    - It will smooth out abrupt clock adjustments to its system clock, resulting from clock synchronization protocols (NTP or PTP), manual configuration, VM pause/resume, etc. 

- The SharedState client clock is based on `performance.now()`, which is a monotonically increasing clock, protected from system clock adjustments.

---

## Clock Estimation

- Server timestamps are measured in **seconds** since **epoch (UTC)**. 
- Clock skew estimation is based on a sliding window of samples (FIFO) (30 samples).
- Clock skew estimation is based on smallest RTT within the sample window and assumes symmetric request/reply network latency.
- Adjustment to the server clock will only be observable by the client when the sample window has progressed enough to better reflect the new reality.



