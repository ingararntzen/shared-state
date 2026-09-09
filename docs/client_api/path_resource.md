# PathResource API

`PathResource` is an interface representing a path-exclusive state provider resource (`ItemProvider` or `OptimisticItemProvider`). It manages state replication, key-value item mapping, and real-time update synchronization for an entire path.

`PathResource` instances are acquired via:

```javascript
const pathResource = client.get_resource(token, path);
```

## Properties

### `path`

**Type**: `string`

Canonical path of the state provider.

### `size`

**Type**: `number`

Total number of items in the resource.

## Methods

### `get_item(id)`

Retrieves an item state object by ID.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `string` | Target item identifier |

**Returns**: `Object` | `undefined` - Item state object `{ id, state }`, or `undefined` if not present

### `get_items()`

Retrieves all item state objects within the resource.

**Returns**: `Array.<Object>` - Array of item state objects `{ id, state }`

### `has_item(id)`

Checks if an item exists within the resource.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `string` | Target item identifier |

**Returns**: `boolean` - `true` if item exists, `false` otherwise

### `update_items(changes, options)`

Updates items stored in the path resource across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `[changes]` | `Object` | Delta changes object `{ insert, remove, reset }` |
| `[options]` | `Object` | Update options |

**Returns**: `Promise.<Object>` - Resolves when state update is dispatched/processed

### `add_callback(handler)`

Registers a callback invoked whenever state changes on this path.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | `function` | Callback function receiving change events |

**Returns**: `Object` - Subscription handle object with `.off()` or `.remove()` method

### `remove_callback(handle)`

Removes a registered callback.

| Parameter | Type | Description |
| --- | --- | --- |
| `handle` | `Object` | Subscription handle returned from `add_callback` |

