[Connection]: /design/abstraction/connection 

# Connection

> The [Connection] object automatically reconnects to mask intermittent network failures.


The [Connection] of the SharedState client encapsulates support for automated reconnection, and allows applications to monitor the connection status. The connection object is a thin wrapper around a raw WebSocket object.

```javascript
const client = new SharedStateClient("ws://localhost:9000");

// Check current state
console.log(client.connection.state); // "connecting", "connected", "disconnected", or "terminated"

// Await connection readiness
await client.connection.connectedPromise();
console.log("Client is connected to server!");
```

### Connection States

- **`DISCONNECTED`** (`"disconnected"`): Disconnected, but automated reconnect attempts are active or pending. (Initial state)
- **`CONNECTING`** (`"connecting"`): Establishing connection and completing WebSocket handshake.
- **`CONNECTED`** (`"connected"`): The connection is active and ready to use.
- **`TERMINATED`** (`"terminated"`): Disconnected and max reconnect attempts has been reached. (Termination state)

---

## Reconnect Mechanics

When network drops or server restart occurs:
- Up to **3 consecutive** reconnect attempts.
- Reconnect delays: **1s** before the 1st attempt, **2s** before the 2nd attempt, and **3s** before the 3rd attempt.
- If connection isr successfully re-established, the attempt counter resets to zero.
- If all 3 attempts fail, max attempts is reached, and the connection state transitions to **`TERMINATED`**.  


```javascript
retryCount = 0;

function on_reconnect() {
    if (state === ConnectionState.DISCONNECTED) {
        state = ConnectionState.CONNECTING;
        retryCount++;
    }    
}

function on_connected() {
    if (state === ConnectionState.CONNECTING) {
        state = ConnectionState.CONNECTED;
        retryCount = 0;
    }
}

function on_error() {
    if (state === ConnectionState.CONNECTING || state === ConnectionState.CONNECTED) {
        if (retryCount < 3) {
            state = ConnectionState.DISCONNECTED;
        } else {
            state = ConnectionState.TERMINATED;
        }
    }
}
```
