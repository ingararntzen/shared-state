# Connection

The `client.connection` instance (`Connection`) manages transport connection state, automatic reconnects, and connection lifecycle events.

## ConnectionState Enum

Valid connection state strings:
- `"disconnected"`
- `"connecting"`
- `"connected"`
- `"terminated"`

## Properties

### `state`

**Type**: `ConnectionState`

Current connection state (`"disconnected"`, `"connecting"`, `"connected"`, `"terminated"`).

### `url`

**Type**: `string`

Target WebSocket URL.

### `options`

**Type**: `Object`

Connection configuration options.

## Methods

### `send(data)`

Sends raw text data over the WebSocket connection.

| Parameter | Type | Description |
| --- | --- | --- |
| `data` | `string` | Payload string to send |

**Returns**: `void`

### `connectedPromise()`

Returns a Promise that resolves when the WebSocket reaches the CONNECTED state.

**Returns**: `Promise.<void>` - Resolves upon successful connection

### `close()`

Closes the WebSocket connection and marks state as TERMINATED (disables auto-reconnect).

**Returns**: `void`

### `reconnect(immediate)`

Triggers a manual connection reset and reconnect.

| Parameter | Type | Description |
| --- | --- | --- |
| `[immediate]` | `boolean` | Whether to reconnect immediately or after a 1s delay |

**Returns**: `void`

