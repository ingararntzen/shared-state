# ValueResource API

Interface to resource that represents a single value.

## Properties

### `provider`

**Type**: `Object`

Underlying state provider instance.

## Methods

### `get()`

Retrieves the current value of the resource.

**Returns**: `*` - Current value or `undefined` if resource is not initialized

### `is_initialized()`

Checks whether the resource has been initialized.

**Returns**: `boolean` - `true` if resource is initialized, `false` otherwise

### `set(value, options)`

Request an update to the value of the resource.

| Parameter | Type | Description |
| --- | --- | --- |
| `value` | `*` | New value |
| `[options]` | `Object` | Update options |
| `[options.dropIfModified=false]` | `boolean` | If true, server drops the update request if resource has been modified by other client in the mean time. |

**Returns**: `Promise.<Object>` - Resolves when state update is dispatched/processed

### `add_callback(handler())`

Registers a callback invoked whenever the resource changes.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler()` | `function` | Callback function receiving change event |

**Returns**: `Object` - Subscription handle with `.remove_callback()`

### `remove_callback(handle)`

Removes a registered callback.

| Parameter | Type | Description |
| --- | --- | --- |
| `handle` | `Object` | Subscription handle returned from add_callback |

