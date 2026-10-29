# SharedMap

Online-hosted key-value store emulating the standard JavaScript `Map` interface.


`SharedMap` is enhanced with the [**Events**](/client_api/events) interface (`eventify`). 
Subscribing via `.on_change(handler, [options])` registers a handler for state changes, receiving [`changes`](/client_api/types#changes) as handler payload.

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

### `on_change(handler, options)`

Subscribes to state change events on the map.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | [`MapChangeHandler`](#mapchangehandler) | Handler function receiving `(changes, eInfo)` |
| `[options]` | `Object` | Subscription options |
| `[options.init=false]` | `boolean` | If true, delivers initial state upon subscription |
| `[options.once=false]` | `boolean` | If true, automatically cancels the subscription after its first invocation |

**Returns**: [`Subscription`](/client_api/events#subscription) - Subscription handle with `.cancel()` method

## Handlers

### `MapChangeHandler(changes, eInfo)` Handler {#mapchangehandler}

Handler function signature invoked when map entries change.
Collections yield direct collection `changes` ({insert: Map, remove: Set, reset: Boolean}).

| Parameter | Type | Description |
| --- | --- | --- |
| `changes` | [`Changes`](/client_api/types#changes) | Direct collection changes `{ insert: Map<string, Item>, remove: Set<string>, reset: boolean }` |
| `eInfo` | [`EventInfo`](/client_api/events#eventinfo) | Event metadata object detailing source, count, init status, and subscription handle |

