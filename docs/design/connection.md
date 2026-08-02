[SharedState Client]: /design/framework#sharedstate-client
[SharedState Server]: /design/framework#sharedstate-server

# Connection

> The [SharedState Client] automatically re-connects to the server after network disruptions.

---

## Automated Reconnect

The [SharedState Client] automatically attempts to reconnect with the server after network drops, transient connection failures, or server restarts. This allows applications to seamlessly handle short-lived network issues without having to implement this logic within the application layer.

Support for automated reconnect is realized by wrapping the raw `WebSocket` object, creating a higher-level connection concept: `WebSocketIO`.

- After detecting a connection failure, the `WebSocketIO` instance attempts to reconnect. 
- There is a delay before each reconnect attempt, which increases linearly with the number of attempts (1 second before first attempt, 2 seconds before second attempt, and 3 seconds before third attempt). 
- If the connection cannot be successfully re-established after 3 **consecutive** attempts, the `WebSocketIO` instance is terminated and will no longer attempt to reconnect.
- If the connection is successfully re-established, the attempt counter is reset, and the `WebSocketIO` instance behaves as if it was newly created.

---


## Connection States

`WebSocketIO` implements a state machine internally with the following states:

- **`DISCONNECTED`** (`"disconnected"`): The WebSocket is **not** `CONNECTING` or `CONNECTED`, and the **reconnect limit** has **not** been reached. This is the initial state.
- **`CONNECTING`** (`"connecting"`): The socket is trying to connect or completing the WebSocket handshake.
- **`CONNECTED`** (`"connected"`): The WebSocket handshake has successfully completed and the socket is ready for use.
- **`TERMINATED`** (`"terminated"`): The WebSocket is **not** `CONNECTING` or `CONNECTED`, and the reconnect limit has been reached. This is the terminal state.

---

## State Machine Logic

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

::: tip SharedStateClient Integration
The `SharedStateClient` exposes its connection object on the `connection` property, allowing application code to **access** and **observe** live connection state.
:::

