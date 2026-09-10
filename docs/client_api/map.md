# SharedMap

`SharedMap` is a replicated map data structure mirroring the standard JavaScript `Map` interface with real-time network synchronization.

> [!NOTE]
> `SharedMap` emits a **`"change"`** event with callback signature `callback(changes, eInfo)` where `changes` is a delta object containing `{ insert, remove, reset }`. See **[Event Mechanism](/client_api/events)** for details.

## Constructor

### `new SharedMap(client, path, [options])`

Initializes a new `SharedMap` instance.

| Parameter | Type | Description |
| --- | --- | --- |
| `client` | `SharedStateClient` | Parent SharedState client instance |
| `path` | `string` | Target path prefix for the map |
| `[options]` | `Object` | Configuration options |

## Methods

### `set(key, value)`

Sets a key-value pair in the map across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | `string` | Map key |
| `value` | `*` | Value to associate with key |

**Returns**: `Promise.<void>` - Resolves when update is processed

### `delete(key)`

Removes an entry specified by key from the map.

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | `string` | Key to delete |

**Returns**: `Promise.<void>` - Resolves when update is processed

### `clear()`

Removes all key-value entries from the map.

**Returns**: `Promise.<void>` - Resolves when map is reset

### `get(key)`

Retrieves the value associated with a key.

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | `string` | Key to look up |

**Returns**: `*` - Associated value, or `undefined` if key does not exist

### `has(key)`

Checks whether a key exists in the map.

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | `string` | Key to check |

**Returns**: `boolean` - `true` if key exists, `false` otherwise

### `keys()`

Returns an array of keys present in the map.

**Returns**: `string[]` - Array of keys

### `values()`

Returns an array of values present in the map.

**Returns**: `*[]` - Array of values

### `entries()`

Returns an array of `[key, value]` pairs present in the map.

**Returns**: `Array[]` - Array of [key, value] pairs

### `forEach(callback, thisArg)`

Executes a callback function once per map entry.

| Parameter | Type | Description |
| --- | --- | --- |
| `callback` | `function` | Function executing `(value, key, map)` |
| `[thisArg]` | `*` | Value to use as `this` when executing callback |

