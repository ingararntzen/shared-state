# Events

The `eventify` decorator can be used on objects or class prototype objects in order to imbue the target object with event capabilities.

## `eventify(target)`

Decorates/enhances an object or class prototype with event capabilities.
Can be called on class prototypes (e.g. `eventify(MyClass.prototype)`) or individual instances.

Adds methods: `on`, `off`, `once`, `emit`.

| Parameter | Type | Description |
| --- | --- | --- |
| `target` | `Object` | The object or prototype to enhance. |

## `on(name, handler, [options])`

Register an event handler for a named event.

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Event name (e.g. "change") |
| `handler` | `handler` | Callback function invoked when event is emitted. |
| `[options]` | `Object` | Subscription options |
| `[options.init=false]` | `boolean` | If true, requests immediate event delivery upon subscription |

**Returns**: `Object` - Subscription handle object (supports `.off()`)

## `off(handle)`

Unsubscribes an event handler using the handle object returned by `on()`.

| Parameter | Type | Description |
| --- | --- | --- |
| `handle` | `Object` | Subscription handle object returned by `on()` |

## `once(name, handler, [options])`

Subscribes a handler callback for a single event execution.
Automatically unsubscribes after the handler is invoked once.

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Event name string |
| `handler` | `handler` | Callback function invoked once |
| `[options]` | `Object` | Subscription options |

**Returns**: `Objectn` - Subscription handle object (supports `.off()`)

## `emit(name, eArg)`

Emits an event with the specified name and payload argument to subscribed handlers.

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Event name string (e.g. "change") |
| `eArg` | `*` | Event payload data delivered to handlers |

## Initial State & `get_current_state(name)` Requirement

Optional method implemented by stateful event sources to provide state snapshots for initial state events.

If implemented, `get_current_state(name)` returns the current state snapshot for the given event `name`.
If it returns `null`, initial state event delivery (`options.init = true`) is deferred until the first `emit(name, ...)` call occurs.
If not implemented on the target, subscribing with `options.init = true` delivers an initial event immediately with `eArg = undefined`.

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Event name string |

## `EventInfo`

**Type**: `Object`

Event info passed as second parameter (`eInfo`) to event callbacks.

| Property | Type | Description |
| --- | --- | --- |
| `src` | `Object` | Source state object emitting the event |
| `name` | `string` | Event name string (e.g. "change") |
| `count` | `number` | Total times this event listener has been invoked |
| `init` | `boolean` | True if this is an initial state event (count === 1) |
| `handle` | `Object` | Subscription handle object (supports `.off()`) |

