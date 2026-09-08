# SharedStateClient

The `SharedStateClient` manages logical network connections, subscriptions, state providers, and application objects.

## Constructor

### `new SharedStateClient(url, [options])`

Initializes a new SharedState logical client connection.

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | `string` | WebSocket server URL |
| `[options]` | `Object` | Configuration options |

## Accessors & Properties

### `id`

**Type**: `string`

Unique logical client identifier generated for consistency tracking.

### `connection`

**Type**: `Connection`

Connection transport manager instance.

### `clock`

**Type**: `ServerClock`

Server clock sync provider instance.

## Methods

### `provider(rawPath, options)`

Initializes or retrieves an existing state provider (ItemProvider / OptimisticItemProvider) for a given path.

| Parameter | Type | Description |
| --- | --- | --- |
| `rawPath` | `string` | Target path (e.g. "/app/store/res") |
| `[options]` | `Object` | Options (e.g. { optimistic: true }) |

**Returns**: `ItemProvider` | `OptimisticItemProvider` - The initialized or cached state provider instance

### `terminate()`

Terminates the client: releases all collections, providers, subscriptions, and closes the WebSocket connection.

**Returns**: `void`


> See **[Connection](/client_api/connection)** for details on `client.connection`.
> See **[Server Clock](/client_api/clock)** for details on `client.clock`.
