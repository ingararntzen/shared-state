# SharedStateClient

The `SharedStateClient` manages logical network connections, subscriptions, state providers, and application objects.

## Constructor

### `new SharedStateClient(url, [options])`

Initializes the SharedStateClient.

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | `string` | WebSocket server URL (ws://host:port/) |
| `[options]` | `Object` | Configuration options |
| `[options.failureTimeout=10]` | `number` | Time in seconds before unacknowledged updates trigger a timeout reconnect |

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

### `get_resource(token, path)`

Request path-exclusive access to a PathResource given token and path.
Returns PathResource (ItemProvider instance) if access is granted.
Throws error if access was already granted for another token.

| Parameter | Type | Description |
| --- | --- | --- |
| `token` | `string` | Access token |
| `path` | `string` | Path of PathResource (e.g. "/app/store/res") |

**Returns**: `Object` - - PathResource handle for path

### `get_item_resource(token, path, itemID)`

Request item-exclusive access to a ValueResource given token, path, and itemID.
Returns ValueResource handle for (path, itemID) if access is granted.
Throws error if access was already granted for another token.

| Parameter | Type | Description |
| --- | --- | --- |
| `token` | `string` | Access token |
| `path` | `string` | Path of CollectionResource |
| `itemID` | `string` | Item identifier within path |

**Returns**: `ValueResource` - - ValueResource handle

### `terminate()`

Terminates the client: releases all providers, subscriptions, bindings, and closes the WebSocket connection.

**Returns**: `void`


> See **[Connection](/client_api/connection)** for details on `client.connection`.
> See **[Server Clock](/client_api/clock)** for details on `client.clock`.
