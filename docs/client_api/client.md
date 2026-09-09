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

### `get_resource(token, path, itemID)`

Request access to resource, given token and resource identifier (path, ItemID).
Returns [reader, updater] pair for resource, if access is granted.
Throws error if access was already granted for another token.

| Parameter | Type | Description |
| --- | --- | --- |
| `token` | `string` | Access token. |
| `path` | `string` | Path to ItemProvider (e.g. "/app/store/res") |
| `[itemID]` | `string` | ItemID within ItemProvider. Omit for path-exclusive resource access. |

**Returns**: `Array.<Object>` - - Tuple [reader, updater] for resource.

### `terminate()`

Terminates the client: releases all providers, subscriptions, bindings, and closes the WebSocket connection.

**Returns**: `void`


> See **[Connection](/client_api/connection)** for details on `client.connection`.
> See **[Server Clock](/client_api/clock)** for details on `client.clock`.
