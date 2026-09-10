# ValueResource API

Interface representing a single-value resource bound to a specific item name within a CollectionResource.

## Properties

### `name`

**Type**: `string`

Item name identifier.

### `provider`

**Type**: `Object`

Underlying CollectionResource (Layer 1 state provider).

## Methods

### `get()`

Retrieves the current state/value of the item.

**Returns**: `*` - Associated item state, or `undefined` if item is uninitialized

### `is_initialized()`

Checks whether the item has been initialized in provider state.

**Returns**: `boolean` - `true` if item is initialized, `false` otherwise

### `set(value, options)`

Updates the item value across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `value` | `*` | New item state value |
| `[options]` | `Object` | Update options |

**Returns**: `Promise.<Object>` - Resolves when state update is dispatched/processed

### `add_callback(handler)`

Registers a callback invoked whenever this specific item is updated or reset.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | `function` | Callback receiving changes payload |

**Returns**: `Object` - Subscription handle with `.off()` method

### `remove_callback(handle)`

Removes a registered callback.

| Parameter | Type | Description |
| --- | --- | --- |
| `handle` | `Object` | Subscription handle returned from add_callback |

