[SharedState Client]: /design/framework#sharedstate-client
[SharedState Server]: /design/framework#sharedstate-server

# Clock

> - [SharedState Client] provides a local clock synchronized with the system clock of the [SharedState Server].


---


## Client-side Server Clock

The server clock is available as a property on the [SharedState Client], highlighting that clocks can also be regarded as shared state.

```javascript
// local timestamp, server timestamp, and current estimates for clock skew and network rtt.
const local_time = ss_client.local_clock.now();
const server_time = ss_client.server_clock.now();
const skew = ss_client.server_clock.skew;
const rtt = ss_client.server_clock.rtt;
```
---


## Clock sampling

All timestamps are measured in seconds since epoch (UTC).

```javascript
// ts0: local time when request sent
// ts1: server time when request processed
// ts2: local time when reply received
const ts0 = CLOCK.now();
const samples = [];
ss_client.get("/clock").then(({ok, ts1}) => {
    if (ok) {
        const ts2 = CLOCK.now();
        samples.push([ts0, ts1, ts2]);    
    }
});

```

---

## Clock estimation

- Sampling of the server clock is performed using the websocket connection.
- Sampling is fast paced initially after connection has been established, then slows down, ultimately stabilising at 1 sample per 10 seconds.
- Clock skew estimation is based on a sliding window of samples (FIFO) (30 samples).
- Clock skew estimation is based on smallest RTT within the sample window and assumes symmetric request/reply communication delay.
- Time measurements on both Client and Server are in **seconds** since **Epoch (UTC)**.
- The Client clock is monotonically increasing, based on `performance.now()`, but will occationally exhibit very small discontinuities (likely not easily observable) whenever the clock skew estimate changes. 
- If the Server Clock experiences discontinuities (e.g. from NTP clock adjustment), this may not be detected immediately by the Client, as clock skew estimate is based on smallest RTT within the sample window.

