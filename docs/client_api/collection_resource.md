# CollectionResource API

Interface to resources that represent a collection of items.

## Properties

### `provider`

**Type**: `Object`

Underlying state provider instance.

### `size`

**Type**: `number`

Total number of items in the resource.

## Methods

### `get_item(id)`

Retrieves an item by ID.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `string` | Target item identifier |

**Returns**: [`Item`](/client_api/types#item) | `undefined`

### `get_items()`

Retrieves all items within the resource.

**Returns**: [`Item`](/client_api/types#item)[]

### `has_item(id)`

Checks if an item exists within the resource.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `string` | Target item identifier |

**Returns**: `boolean` - `true` if item exists, `false` otherwise

### `update_items(changes, options)`

Request an update to items in the resource.

| Parameter | Type | Description |
| --- | --- | --- |
| `changes` | [`Changes`](/client_api/types#changes) | Requested [`Changes`](/client_api/types#changes) |
| `[options]` | `Object` | Update options |
| `[options.conditional=false]` | `boolean` | If true, a conditional update will be performed based on server version |

**Returns**: `Promise.<Object>` - Resolves when state update is acknowledged by the server

### `add_callback(handler(changes))`

Registers a callback invoked whenever the resource changes.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler(changes)` | `function` | Callback function receiving change event |

**Returns**: `Object` - Subscription handle object with `.remove_callback()`.

### `remove_callback(handle)`

Removes a registered callback.

| Parameter | Type | Description |
| --- | --- | --- |
| `handle` | `Object` | Subscription handle returned from `add_callback` |

