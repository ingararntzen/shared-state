# SharedSet

Online-hosted set data structure emulating the standard JavaScript `Set` interface.


`SharedSet` is enhanced with the [**Events**](/client_api/events) interface (`eventify`).
Subscribing via `.on_change(handler, [options])` registers a handler for state changes, receiving [`changes`](/client_api/types#changes) as handler payload.

## Constructor

### `new SharedSet(client, path, [options])`

Initializes a SharedSet instance.

| Parameter | Type | Description |
| --- | --- | --- |
| `client` | [`SharedStateClient`](/client_api/client) | SharedState client instance |
| `path` | `string` | Resource [Path](/design/representation/item_collection#path) |
| `[options]` | `Object` | Configuration options |
| `[options.key]` | [`KeyFunction`](#keyfunction) | Custom element identity key function receiving `elem` and returning a unique key |

## Properties

### `size`

**Type**: `number`

Returns the number of elements in the set.

### `provider`

**Type**: `Object`

The underlying PathResource (ItemProvider instance).

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

### `on_change(handler, options)`

Subscribes to state change events on the set.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | [`SetChangeHandler`](#setchangehandler) | Handler function receiving `(changes, eInfo)` |
| `[options]` | `Object` | Subscription options |
| `[options.init=false]` | `boolean` | If true, delivers initial state upon subscription |
| `[options.once=false]` | `boolean` | If true, automatically cancels the subscription after its first invocation |

**Returns**: [`Subscription`](/client_api/events#subscription) - Subscription handle with `.cancel()` method

## Handlers & Callbacks

### `KeyFunction` {#keyfunction}

**Type**: `function`

Callback function signature used to calculate a unique key for set elements.

| Parameter | Type | Description |
| --- | --- | --- |
| `elem` | `*` | Element added to or queried in the set |

**Returns**: `string` | `number` - Unique key identifying the element

### `SetChangeHandler(changes, eInfo)` Handler {#setchangehandler}

Handler function signature invoked when set elements change.
Collections yield direct collection `changes` ({insert: Map, remove: Set, reset: Boolean}).

| Parameter | Type | Description |
| --- | --- | --- |
| `changes` | [`Changes`](/client_api/types#changes) | Direct collection changes `{ insert: Map<string, Item>, remove: Set<string>, reset: boolean }` |
| `eInfo` | [`EventInfo`](/client_api/events#eventinfo) | Event metadata object detailing source, count, init status, and subscription handle |

