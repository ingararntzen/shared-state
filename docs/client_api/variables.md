# SharedVariables

SharedVariable represents an online-hosted value.
Extends {@link BaseAbstraction}.

`SharedVariable` implements the [**Events**](/client_api/events) interface.
All state changes are emitted on the `"change"` event, with `{new: newValue, old: oldValue}` as callback payload.

## SharedVariable Common Interface

All SharedVariable types support the following properties and methods:

### `name`

**Type**: `string`

The name/key of the variable.

### `value`

**Type**: `*`

The current local value of the variable.

### `provider`

**Type**: `Object`

The underlying PathResource (ItemProvider instance).

### `get()`

Gets the current value of the variable.

**Returns**: `*` - The current variable value

### `set(val)`

Updates the variable value across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `val` | `*` | New value to set |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

## SharedVariable

Generic *untyped* variable holding any serializable value.

## SharedBoolean

Variable restricted to *boolean* values.

### Specific Methods

### `toggle()`

Toggles the boolean value (`true` -> `false`, `false` -> `true`).

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

## SharedString

Variable restricted to *string* values.

## SharedInteger

Variable restricted to *integer* values.
Supports increment and decrement operations.

### Specific Methods

### `inc(delta)`

Increments the integer value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta=1]` | `number` | Amount to increment |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

### `dec(delta)`

Decrements the integer value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta=1]` | `number` | Amount to decrement |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

## SharedFloat

Variable restricted to floating-point values.
Supports increment and decrement operations.

### Specific Methods

### `inc(delta)`

Increments the float value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta=1.0]` | `number` | Amount to increment |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

### `dec(delta)`

Decrements the float value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta=1.0]` | `number` | Amount to decrement |

**Returns**: `Promise.<void>` - Resolves when update request is acknowledged by the server

## SharedRecord

Variable restricted to *object* values.

## SharedArray

Variable restricted to *array* values.

