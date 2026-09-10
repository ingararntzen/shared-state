# SharedSet

Online-hosted set data structure emulating the standard JavaScript `Set` interface.


`SharedSet` implements the [**Events**](/client_api/events) interface.
All state changes are emitted on the `"change"` event, with [`changes`](/client_api/types#changes) as callback payload.

## Constructor

### `new SharedSet(client, path, [options])`

Initializes a SharedSet instance.

| Parameter | Type | Description |
| --- | --- | --- |
| `client` | [`SharedStateClient`](/client_api/client) | SharedState client instance |
| `path` | `string` | Resource [Path](/design/representation/item_collection#path) |
| `[options]` | `Object` | Configuration options |
| `[options.key]` | [`KeyFunction`](#keyfunction-callback) | Custom element identity key function receiving `elem` and returning a unique key |

## Properties

### `size`

**Type**: `number`

Returns the number of elements in the set.

## Methods

### `add(elem)`

Adds an element to the set across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element to add |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

### `delete(elem)`

Removes an element from the set.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element to remove |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

### `clear()`

Removes all elements from the set.

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

### `has(elem)`

Checks whether an element exists in the set.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element to check |

**Returns**: `boolean` - `true` if element exists, `false` otherwise

### `keys()`

Returns an iterator over elements in the set (alias for `values()`).

**Returns**: `Iterator.<*>` - Iterator for set values

### `values()`

Returns an iterator over elements present in the set.

**Returns**: `Iterator.<*>` - Iterator for set values

### `entries()`

Returns an iterator over `[value, value]` pairs present in the set.

**Returns**: `Iterator.<Array>` - Iterator for value pairs

### `forEach(callback, thisArg)`

Executes a callback function once per element in the set.

| Parameter | Type | Description |
| --- | --- | --- |
| `callback` | `function` | Function executing `(value, value, set)` |
| `[thisArg]` | `*` | Value to use as `this` when executing callback |

## Callbacks

### `KeyFunction(elem)` Callback

Callback function signature used to calculate a unique key for set elements.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element added to or queried in the set |

**Returns**: `string` | `number` - Unique key identifying the element

