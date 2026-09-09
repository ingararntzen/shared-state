# SharedStateClient

The `SharedStateClient` manages logical network connections, subscriptions, state providers, and application objects.

## Constructor

### `new SharedStateClient(url, [options])`

Initializes the SharedStateClient.

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | `string` | WebSocket server URL (ws://host:port/) |
| `[options]` | `Object` | Configuration options |
| `[options.failureTimeout]` | `number` | Time in seconds before unacknowledged updates trigger a timeout reconnect |

## Accessors & Properties

### `id`

**Type**: `string`

Unique client identifier.

### `connection`

**Type**: `Connection`

Connection object.

### `clock`

**Type**: `ServerClock`

ServerClock object.

## Methods

### `provider(token, path, itemID, options)`

Initializes or retrieves an existing state provider pair [reader, updater] for a path or (path, itemID).
Locks the path or (path, itemID) to the given token to prevent type mismatches.

| Parameter | Type | Description |
| --- | --- | --- |
| `token` | `string` | Binding token reserving scope (e.g. "SharedMap", "MyCustomApp") |
| `path` | `string` | Target path (e.g. "/app/store/res") |
| `[itemID]` | `string` | Target item ID for item-exclusive binding (omit for path-exclusive) |
| `[options]` | `Object` | Provider options |

**Returns**: `Array.<Object>` - Tuple containing [reader, updater]

### `terminate()`

Terminates the client: releases all providers, subscriptions, bindings, and closes the WebSocket connection.

**Returns**: `void`


> See **[Connection](/client_api/connection)** for details on `client.connection`.
> See **[Server Clock](/client_api/clock)** for details on `client.clock`.
