# SharedVariables

SharedVariables are reactive, single-value abstractions synchronized in real time across clients and server.

> [!NOTE]
> All SharedVariable instances emit a **`"change"`** event with callback signature `callback(newValue, eInfo)` whenever their local or remote value updates. See **[Event Mechanism](/client_api/events)** for details.

## SharedVariable Common Interface

All SharedVariable types support the following properties and methods:

### `name`

**Type**: `string`

The name/key of the variable.

### `value`

**Type**: `*`

The current local value of the variable.

### `path`

**Type**: `string`

Full path identifying this variable (`path/name`).

### `get()`

Gets the current value of the variable.

**Returns**: `*` - The current variable value

### `set(val)`

Updates the variable value across the network.

| Parameter | Type | Description |
| --- | --- | --- |
| `val` | `*` | New value to set |

**Returns**: `Promise.<void>` - Resolves when state update is processed

## SharedVariable

Generic untyped shared variable holding any serializable value.

## SharedBoolean

Shared boolean variable.

### Specific Methods

### `toggle()`

Toggles the boolean value (`true` -> `false`, `false` -> `true`).

**Returns**: `Promise.<void>` - Resolves when state update is processed

## SharedString

Shared string variable.

## SharedInteger

Shared integer variable supporting increment and decrement operations.

### Specific Methods

### `inc(delta)`

Increments the integer value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta]` | `number` | Amount to increment |

**Returns**: `Promise.<void>` - Resolves when state update is processed

### `dec(delta)`

Decrements the integer value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta]` | `number` | Amount to decrement |

**Returns**: `Promise.<void>` - Resolves when state update is processed

## SharedFloat

Shared floating-point number variable.

### Specific Methods

### `inc(delta)`

Increments the float value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta]` | `number` | Amount to increment |

**Returns**: `Promise.<void>` - Resolves when state update is processed

### `dec(delta)`

Decrements the float value by delta.

| Parameter | Type | Description |
| --- | --- | --- |
| `[delta]` | `number` | Amount to decrement |

**Returns**: `Promise.<void>` - Resolves when state update is processed

## SharedObject

Shared JSON object variable.

## SharedArray

Shared array variable.

