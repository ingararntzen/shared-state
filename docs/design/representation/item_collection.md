[Item]: #item
[Items]: #item
[Path]: #path
[Paths]: #path
[Changes]: #changes
[ItemCollection]: #itemcollection
[ItemCollections]: #itemcollection
[ItemStore]: /design/representation/item_store
[ItemStores]: /design/representation/item_store
[ProxyCollection]: /design/representation/proxy_collection
[ProxyCollections]: /design/representation/proxy_collection

# Item Collections

> - The SharedState server hosts [ItemCollections] identified by [Paths].
> - The SharedState client mirrors server-side [ItemCollections] locally. 

---

The SharedState framework facilitates the sharing of application resources, such as `strings`, `numbers`, `booleans`, `objects`, `arrays`, or more advanced abstractions like `Set`, `Map`, `List`, or `Tree`.

Importantly, the framework does not provide custom supprt for each of these data types, but rather provides a generic state sharing mechanism as a common basis for all these types (see [Replication Strategy](/concept/replication)).


---

## Definitions

### Item
<a id="item"></a>

An [Item] is a thin wrapper around an element of application state:

```json
{
  "id": "item-id",
  "state": { /* JSON serializable object */ }
}
```

- `id` (string) uniquely identifies an item within an [ItemCollection]. 
- `state` must be a JSON-serializable object or value.

The SharedState server is agnostic to the internal representation of `state`. The `id` property must be provided by the application. If the `state` element originates from a data model that already includes a unique identifier such as `_id`, `key`, or `uuid`, it may be convenient to reuse this identifier as `item.id`.

### ItemCollection
<a id="itemcollection"></a>

An [ItemCollection] is an unordered collection of [Items] where the `id` of each [Item] is unique within the collection:

```
ItemCollection: ({id_1, state_1}, {id_2, state_2}, ..., {id_n, state_n})
```

The [ItemCollection] allows individual [Items] to be added, removed, or replaced. Batch updates allow multiple removals and insertions to be performed in a single, atomic operation.

### Changes
<a id="changes"></a>

State mutations on an [ItemCollection] are expressed using a [Changes] object with three optional fields:

```javascript
const changes = {remove: [], insert: [], reset: false};
```

#### Parameters
* **`remove`**: Array of item IDs (`string[]`, default: `[]`) for items to be removed from the collection.
* **`insert`**: Array of [Items] (`Item[]`, default: `[]`) to be inserted or replaced in the collection.
* **`reset`**: Boolean (`boolean`, default: `false`). When `true`, clears all existing items in the collection prior to applying insertions (`remove` array is ignored).

#### Execution Rules
1. **Ordering**: `remove` is processed ahead of `insert`.
2. **Upsert Semantics**: `insert` automatically replaces any existing item with the same `id` (insert-or-replace).
3. **Reset Semantics**: `reset` clears all items in the collection before applying `insert`, causing any `remove` array to be safely ignored.

#### Change Matrix

The combination of `remove`, `insert`, and `reset` allows collection mutations to be expressed compactly:

| State Changes | Effect |
| :--- | :--- |
| `{ remove: [], insert: [], reset: false }` | **No Changes** |
| `{ remove: [], insert: [...], reset: false }` | **Insert or Replace Items** |
| `{ remove: [...], insert: [], reset: false }` | **Delete Items** |
| `{ remove: [...], insert: [...], reset: false }` | **Delete Items + Insert or Replace Items** |
| `{ reset: true }` | **Clear all Items** |
| `{ insert: [...], reset: true }` | **Clear all Items + Insert Items** |


### Path
<a id="path"></a>

A server-side [ItemCollection] is uniquely identified by a 3-part [Path]:

```
/app/store/resource
```

* **`app`**: The name of the application, to which the resource belongs.
* **`store`**: The name of the store which manages the resource.
* **`resource`**: The name of the resource.

While the 3-part [Path] structure is fixed, applications can define an application-specific namespace by introducing delimiters into the `resource` component of the [Path]:

```
/myapp/items/room1-chat
/myapp/items/room1_whiteboard
```

* **Forward slashes (`/`) are reserved** for the 3-part path hierarchy (`/app/store/resource`) and cannot be used as delimiters within `resource` name.
* **Underscores (`_`) or hyphens (`-`) are recommended** as delimiters to avoid collisions with characters used by CSS class selectors (`.`), DOM element IDs (`#`), or pseudo-classes (`:`), making resource names safe to use directly in HTML attributes or CSS queries.

---

## Server-Side ItemCollections

Server-side [ItemCollections] are managed by [ItemStores].

---

## Client-Side ItemCollections

Client-side [ItemCollections] are refered to as [ProxyCollections]. 

