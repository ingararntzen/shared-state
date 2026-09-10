# SharedSet

`SharedSet` is a replicated set data structure mirroring the standard JavaScript `Set` interface with real-time network synchronization.

> [!NOTE]
> `SharedSet` emits a **`"change"`** event with callback signature `callback(changes, eInfo)` where `changes` is a delta object containing `{ insert, remove, reset }`. See **[Event Mechanism](/client_api/events)** for details.

## Constructor

### `new SharedSet(client, path, [options])`

Initializes a new `SharedSet` instance.

| Parameter | Type | Description |
| --- | --- | --- |
| `client` | `SharedStateClient` | Parent SharedState client instance |
| `path` | `string` | Target path prefix for the set |
| `[options]` | `Object` | Configuration options |
| `[options.key]` | `Function` | Custom identity key function `(elem) => id` |

## Methods

### `add(elem)`

Adds an element to the set across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element to add |

**Returns**: `Promise.<void>` - Resolves when update is processed

### `delete(elem)`

Removes an element from the set.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element to remove |

**Returns**: `Promise.<void>` - Resolves when update is processed

### `clear()`

Removes all elements from the set.

**Returns**: `Promise.<void>` - Resolves when set is reset

### `has(elem)`

Checks whether an element exists in the set.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element to check |

**Returns**: `boolean` - `true` if element exists, `false` otherwise

### `keys()`

Returns an array of elements in the set (alias for `values()`).

**Returns**: `*[]` - Array of set values

### `values()`

Returns an array of elements present in the set.

**Returns**: `*[]` - Array of set values

### `entries()`

Returns an array of `[value, value]` pairs present in the set.

**Returns**: `Array[]` - Array of value pairs

### `forEach(callback, thisArg)`

Executes a callback function once per element in the set.

| Parameter | Type | Description |
| --- | --- | --- |
| `callback` | `function` | Function executing `(value, value, set)` |
| `[thisArg]` | `*` | Value to use as `this` when executing callback |

