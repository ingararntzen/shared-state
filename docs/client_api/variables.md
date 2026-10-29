# SharedVariables

SharedVariable represents an online-hosted value.


`SharedVariable` is enhanced with the [**Events**](/client_api/events) interface (`eventify`).
Subscribing via `.on_change(handler, [options])` registers a handler for state changes, receiving `{new: newValue, old: oldValue}` as handler payload.

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

### `on_change(handler, options)`

Subscribes to value change events on the variable.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | [`VariableChangeHandler`](#variablechangehandler) | Handler function receiving `(diff, eInfo)` |
| `[options]` | `Object` | Subscription options |
| `[options.init=false]` | `boolean` | If true, delivers initial state upon subscription |
| `[options.once=false]` | `boolean` | If true, automatically cancels the subscription after its first invocation |

**Returns**: [`Subscription`](/client_api/events#subscription) - Subscription handle with `.cancel()` method

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

## Handlers & Types

### `VariableDiff` {#variablediff}

**Type**: `Object`

Value diff payload delivered to variable change handlers.

| Property | Type | Description |
| --- | --- | --- |
| `new` | `*` | The newly updated value |
| `old` | `*` | The previous value (or undefined on initial state) |

### `VariableChangeHandler(diff, eInfo)` Handler {#variablechangehandler}

Handler function signature invoked when variable value changes.
Variables yield a convenient `diff` object (`{ new, old }`), unlike collections which yield `changes` (`{ insert, remove, reset }`).

| Parameter | Type | Description |
| --- | --- | --- |
| `diff` | [`VariableDiff`](#variablediff) | Value diff object `{ new: *, old: * }` |
| `eInfo` | [`EventInfo`](/client_api/events#eventinfo) | Event metadata object detailing source, count, init status, and subscription handle |

