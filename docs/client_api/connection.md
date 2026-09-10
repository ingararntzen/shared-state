# Connection

Connection manages connection state during automated reconnect cycles.

## ConnectionState Enum

Connection states enum for the Connection manager.

| Property | Type | Description |
| --- | --- | --- |
| `DISCONNECTED` | `string` | Connection is closed pending connect (INITIAL STATE). |
| `CONNECTING` | `string` | Connection attempt in progress |
| `CONNECTED` | `string` | Connection is active |
| `TERMINATED` | `string` | Connection was closed and will not reconnect (FINAL STATE). |

## Constructor

### `new Connection(url, [options])`

Connection manages connection state during automated reconnect cycles.

## Properties

### `state`

**Type**: [`ConnectionState`](/client_api/connection#connectionstate-enum)

Current connection state.

### `url`

**Type**: `string`

WebSocket URL.

## Methods

### `connectedPromise()`

Returns a Promise that resolves when the WebSocket reaches the [`ConnectionState.CONNECTED`](/client_api/connection#connectionstate-enum) state.

**Returns**: `Promise.<void>` - Resolves upon successful connection

### `reconnect(options)`

Triggers a manual connection reset and reconnect.

| Parameter | Type | Description |
| --- | --- | --- |
| `[options]` | `Object` | Configuration options |
| `[options.immediate=true]` | `boolean` | Whether to reconnect immediately or after a 1s delay |

**Returns**: `void`

