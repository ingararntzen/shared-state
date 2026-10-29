# Events

The `eventify` decorator can be used on objects or class prototype objects
in order to imbue the target object with single-channel state change event capabilities.

## `eventify(target)`

Decorates/enhances an object or class prototype with state change event capabilities.
Can be called on class prototypes (e.g. `eventify(MyClass.prototype)`) or individual instances.

Adds methods: `on_change`, `_emit`.

| Parameter | Type | Description |
| --- | --- | --- |
| `target` | `Object` | The object or prototype to enhance. |

## `on_change(handler, [options])`

Register an event handler for state changes on this object.

| Parameter | Type | Description |
| --- | --- | --- |
| `handler` | [`handler`](/client_api/events#handler) | Handler function invoked when state changes |
| `[options]` | `Object` | Subscription options |
| `[options.init=false]` | `boolean` | If true, requests immediate initial state delivery upon subscription |
| `[options.once=false]` | `boolean` | If true, automatically cancels the subscription after its first invocation |

**Returns**: [`Subscription`](/client_api/events#subscription) - Subscription handle object (supports `.cancel()`)

## `_emit([changes])`

Emits a state change event with an optional payload argument to subscribed handlers.
Intended to be called internally by the event source (`this._emit(changes)`).

| Parameter | Type | Description |
| --- | --- | --- |
| `[changes]` | `*` | Optional state changes payload delivered to handlers |

## `Subscription` {#subscription}

Subscription handle object returned by `on_change()`. Supports cancellation via `sub.cancel()`.

### `cancel()`

Cancels this subscription so the handler will no longer be invoked.
Safe to call multiple times or prior to initial microtask delivery.

## `handler(changes, eInfo)` Handler Signature {#handler}

Handler function signature invoked when a state change event is emitted.
Handlers default to having `this` bound to the event source instance.

| Parameter | Type | Description |
| --- | --- | --- |
| `changes` | `*` | State changes payload (e.g. `{ insert, remove, reset }` for collections or `{ new, old }` for variables) |
| `eInfo` | [`EventInfo`](/client_api/events#eventinfo) | Event metadata object detailing source, count, init status, and subscription handle |

## `get_current_state()` (Optional)

Optional method implemented by stateful event sources to provide state snapshots for initial state events.

This method is not provided by the decorator, and must therefore be manually implemented.

If implemented, `get_current_state()` returns the current state snapshot.
If it returns `null`, initial state event delivery (`options.init = true`) is deferred until the first `_emit(...)` call occurs.
If not implemented, subscribing with `options.init = true` delivers an initial event with `changes = undefined`.

**Returns**: `*` | `null` - Current state of the object, or null if uninitialized

## `EventInfo` {#eventinfo}

**Type**: `Object`

Event info passed as second parameter (`eInfo`) to event handlers.

| Property | Type | Description |
| --- | --- | --- |
| `src` | `Object` | Object emitting the event |
| `count` | `number` | Total times this event handler has been invoked |
| `init` | `boolean` | True if this is an initial state event (count === 1) |
| `sub` | [`Subscription`](/client_api/events#subscription) | Subscription handle object (supports `.cancel()`) |

