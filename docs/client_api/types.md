# Types & Data Structures

Common data structures and typedefs used throughout the SharedState Client API.

## `Item`

**Type**: `Object`

Represents an Item with an id and state property.

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Item's unique identifier |
| `state` | `*` | Item's state value |

## `Changes`

**Type**: `Object`

Represents changes to a collection of Items.
Changes are used to express a request for changes, or to report changes that were applied.

| Property | Type | Description |
| --- | --- | --- |
| `[insert]` | `Map.<string, Item>` | Map of Items to be inserted or replaced in the collection - <Item.id, Item> |
| `[remove]` | `Set.<string>` | Set of Item.id's to be removed |
| `[reset=false]` | `boolean` | If true, reset all items before insert and ignore remove. |

## `EventInfo`

**Type**: `Object`

Event info passed as second parameter to eventify callbacks.

| Property | Type | Description |
| --- | --- | --- |
| `src` | `Object` | Source state object emitting the event |
| `name` | `string` | Event name string (e.g. "change") |
| `count` | `number` | Total times this event listener has been invoked |
| `init` | `boolean` | True if this is an initial event (count == 0) |
| `handle` | `Object` | Subscription handle object |

