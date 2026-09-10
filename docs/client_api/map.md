# SharedMap

Online-hosted key-value store emulating the standard JavaScript `Map` interface.


`SharedMap` implements the [**Events**](/client_api/events) interface. 
All state changes are emitted on the `"change"` event, with [`changes`](/client_api/types#changes) as callback payload.

## Constructor

### `new SharedMap(client, path)`

Initializes a SharedMap instance.

| Parameter | Type | Description |
| --- | --- | --- |
| `client` | [`SharedStateClient`](/client_api/client) | SharedState client instance |
| `path` | `string` | Resource [Path](/design/representation/item_collection#path) |

## Properties

### `size`

**Type**: `number`

Returns the number of key-value entries in the map.

### `provider`

**Type**: `Object`

The underlying PathResource (ItemProvider instance).

## Methods

### `set(key, value)`

Sets a key-value pair.

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | `string` | Key |
| `value` | `*` | Value to associate with key |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

### `delete(key)`

Removes an entry specified by key from the map.

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | `string` | Key to delete |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

### `clear()`

Removes all key-value entries from the map.

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

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

Returns an iterator over keys present in the map.

**Returns**: `Iterator.<string>` - Iterator for map keys

### `values()`

Returns an iterator over values present in the map.

**Returns**: `Iterator.<*>` - Iterator for map values

### `entries()`

Returns an iterator over `[key, value]` pairs present in the map.

**Returns**: `Iterator.<Array>` - Iterator for [key, value] pairs

### `forEach(callback, thisArg)`

Executes a callback function once per map entry.

| Parameter | Type | Description |
| --- | --- | --- |
| `callback` | `function` | Function executing `(value, key, map)` |
| `[thisArg]` | `*` | Value to use as `this` when executing callback |

