# Type Definitions

Common data structures and typedefs used throughout the SharedState Client API.

## `Item`

**Type**: `Object`

Represents an Item with id and state properties.

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | The unique identifier of the item |
| `state` | `*` | The state of the item |

## `Changes`

**Type**: `Object`

Represents changes to a collection of Items.
Changes are used both to express a request for change and to report changes after the fact.

| Property | Type | Description |
| --- | --- | --- |
| `[insert]` | `Map.<string, [`Item`](/client_api/types#item)>` | Map of Items to be inserted or replaced in the collection - <Item.id, Item> |
| `[remove]` | `Set.<string>` | Set of Item.id's to be removed from the collection |
| `[reset=false]` | `boolean` | If true, reset all items of the collection (ignore remove), before inserting new items |

