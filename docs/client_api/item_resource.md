# ItemResource API

`ItemResource` represents an item-exclusive state resource bound to a single `itemID` within a `PathResource`.

`ItemResource` instances are acquired via:

```javascript
const itemResource = client.get_item_resource(token, path, itemID);
```

## Properties

### `path`

**Type**: `string`

The full canonical path of the underlying state provider.

### `itemID`

**Type**: `string`

Target item identifier.

### `itemId`

**Type**: `string`

Alias for itemID.

### `provider`

**Type**: `Object`

Underlying PathResource (Layer 1 state provider).

## Methods

### `get()`

Retrieves the current state/value of the item.

**Returns**: `*` - Associated item state, or `undefined` if item does not exist

### `item_exists()`

Checks whether the item exists in provider state.

**Returns**: `boolean` - `true` if item exists, `false` otherwise

### `set(value, options)`

Updates the item value across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `value` | `*` | New item state value |
| `[options]` | `Object` | Update options |

**Returns**: `Promise.<Object>` - Resolves when state update is dispatched/processed

### `delete(options)`

Removes the item from the provider state across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `[options]` | `Object` | Update options |

**Returns**: `Promise.<Object>` - Resolves when delete update is dispatched/processed

### `add_callback(handler)`

Registers a callback invoked whenever this specific item is inserted, removed, or reset.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | `function` | Callback receiving changes payload |

**Returns**: `Object` - Subscription handle with `.off()` method

### `remove_callback(handle)`

Removes a registered callback.

| Parameter | Type | Description |
| --- | --- | --- |
| `handle` | `Object` | Subscription handle returned from add_callback |

