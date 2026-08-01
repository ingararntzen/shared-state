[SharedState Client]: /design/framework#sharedstate-client
[SharedState Server]: /design/framework#sharedstate-server

# Connection

> The SharedState client wraps a WebSocket connection to provide a high-level connection abstraction, encapsulating network complexity and automated re-connection.

---

## Logical Connection Architecture

Rather than exposing raw browser WebSockets directly, the [SharedState Client] features a dedicated `connection` instance (an instance of `WebSocketIO`) as a public property:

```javascript
import { SharedStateClient } from "sharedstate-client";
import { ConnectionState } from "sharedstate-client/wsio";

const client = new SharedStateClient("ws://localhost:9000");

// Inspect formal connection state
if (client.connection.state === ConnectionState.CONNECTED) {
    console.log("Client is online");
}

// Await connection readiness
await client.connection.connectedPromise();
```

This composition decouples network transport resilience from higher-level SharedState protocol concerns (such as request-reply multiplexing or resource change deltas).

---

## Connection States (`ConnectionState`)

The `connection` object maintains an explicit, mutually exclusive `state` property modeling a formal state machine:

```javascript
// ConnectionState enum constants (client/wsio.js)
ConnectionState.DISCONNECTED // "disconnected"
ConnectionState.CONNECTING   // "connecting"
ConnectionState.CONNECTED    // "connected"
ConnectionState.TERMINATED   // "terminated"

// Inspect state
console.log(client.connection.state); // "connected"
```

### State Machine Lifecycle

```
[ DISCONNECTED ] ──( connect() )──► [ CONNECTING ] ──( on_open )──► [ CONNECTED ]
       ▲                                 │                               │
       │                                 │ (error / failure)             │ (close() / max retries)
       └──────── (Retry Backoff) ────────┴───────────────────────────────▼
                                                                  [ TERMINATED ]
```

| State | Value | Description |
| :--- | :--- | :--- |
| **`DISCONNECTED`** | `"disconnected"` | Socket is closed; retry backoff timer may be pending. |
| **`CONNECTING`** | `"connecting"` | Handshake / socket connection in progress. |
| **`CONNECTED`** | `"connected"` | Active WebSocket session established. |
| **`TERMINATED`** | `"terminated"` | Max retry limit reached or `close()` explicitly called. No further reconnect attempts will occur. |

---

## Connection Properties & Methods

### Properties

```javascript
client.connection.state    // ConnectionState ("disconnected" | "connecting" | "connected" | "terminated")
client.connection.url      // string: target WebSocket URL
client.connection.options  // object: configuration options (e.g. debug mode, retries)
```

### Transport Methods

```javascript
// Transmit raw payload (dropped safely if not connected)
client.connection.send(data);

// Returns a Promise that resolves when connection state becomes CONNECTED
await client.connection.connectedPromise();

// Explicitly close connection and transition to TERMINATED state
client.connection.close();
```

### Event Callback Hooks

The [SharedState Client] binds internal handlers to these `connection` callbacks:

```javascript
client.connection.on_connect    = () => { /* Handle connection / re-connection */ };
client.connection.on_disconnect = (event) => { /* Handle disconnection */ };
client.connection.on_error      = (error) => { /* Handle transport error */ };
client.connection.on_message    = (data) => { /* Process incoming raw payload */ };
```