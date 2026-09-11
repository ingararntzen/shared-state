# SharedStateClient

The `SharedStateClient` manages logical network connections, subscriptions, state providers, and application objects.

## Constructor

### `new SharedStateClient(url, [options])`

Initializes the SharedStateClient.

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | `string` | WebSocket server URL (ws://host:port/) |
| `[options]` | `Object` | Configuration options |
| `[options.failureTimeout=10]` | `number` | Time in seconds before unacknowledged updates trigger a reconnect |

## Accessors & Properties

### `VERSION`

**Type**: `string`

The client library version string.

### `id`

**Type**: `string`

Unique client identifier.

### `connection`

**Type**: [`Connection`](/client_api/connection)

Connection object managing automated reconnects.

### `serverclock`

**Type**: [`ServerClock`](/client_api/clock)

ServerClock object estimating server time and network latency.

## Methods

### `get_collection_resource(token, path)`

Request access to a [`CollectionResource`](/client_api/collection_resource) given token and path.

| Parameter | Type | Description |
| --- | --- | --- |
| `token` | `string` | Access [Token](/design/abstraction/objects#token-based-resource-access) |
| `path` | `string` | Resource [Path](/design/representation/item_collection#path) |

**Returns**: [`CollectionResource`](/client_api/collection_resource)

### `get_value_resource(token, path, name)`

Request access to a [`ValueResource`](/client_api/value_resource) given token, path, and name.

| Parameter | Type | Description |
| --- | --- | --- |
| `token` | `string` | Access [Token](/design/abstraction/objects#token-based-resource-access) |
| `path` | `string` | Resource [Path](/design/representation/item_collection#path) |
| `name` | `string` | Name of value |

**Returns**: [`ValueResource`](/client_api/value_resource)

### `terminate()`

Terminates the client: releases all providers, subscriptions, bindings, and closes the WebSocket connection.

**Returns**: `undefined`

