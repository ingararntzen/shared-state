[Connection]: /design/abstractions/connection 

# Connection

The SharedState client exposes a [Connection] object (`client.connection`), enabling applications to monitor changes in the connection status. Internally the connection object is a wrapper around a raw WebSocket object, encapsulating support for automated reconnection under intermittent network disruptions.

---

## Developer Abstraction (`client.connection`)

Application code accesses the connection abstraction via `client.connection` (or `client.state`):

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
- **`CONNECTING`** (`"connecting"`): Establishing connection or completing WebSocket handshake.
- **`CONNECTED`** (`"connected"`): The WebSocket handshake is complete and active.
- **`TERMINATED`** (`"terminated"`): Disconnected and max reconnect attempts reached. (Termination state)

---

## Internal Reconnect Mechanics

Underneath the developer-facing `client.connection` interface, automated reconnecting is managed internally.

### Automated Reconnect Strategy

When network drops or server restart occurs:
- Attempt to reconnect, up to **3 consecutive attempts**.
- Reconnect delays increase linearly: **1s** before the 1st attempt, **2s** before the 2nd attempt, and **3s** before the 3rd attempt.
- If re-established successfully, the attempt counter resets to zero.
- If all 3 attempts fail, max attempts is reached, and the connection state transitions to **`TERMINATED`**.  

### State Machine Logic

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
