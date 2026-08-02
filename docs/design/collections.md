[Item]: #item
[Items]: #item
[Path]: #path
[Paths]: #path
[ItemCollection]: #itemcollection
[ItemCollections]: #itemcollection
[ItemStore]: /design/stores
[ItemStores]: /design/stores
[SharedState Client]: /design/framework#sharedstate-client
[SharedState Server]: /design/framework#sharedstate-server


# Item Collections

> - The [SharedState Server] hosts [ItemCollections] identified by [Paths].
> - The [SharedState Client] mirrors server-side [ItemCollections] locally. 

---

The SharedState framework facilitates the sharing of application resources, such as `strings`, `numbers`, `booleans`, `objects`, `arrays`, or more advanced data structures like `Set`, `Map`, `List`, or `Tree`.

Importantly, the framework does not provide custom primitives for each of these data types. Instead, it provides a generic state sharing mechanism, **[ItemCollection]**, as a common basis for all these types (see [Replication Strategy](/concept/replication)).

- The [SharedState Server] hosts [ItemCollections] identified by [Paths].
- The [SharedState Client] mirrors server-side [ItemCollections] and makes them available on the client side as local proxy objects.

---

## Definitions

### Item
<a id="item"></a>

An [Item] is a thin wrapper around an element of application state:

```
Item : {id, state}
```

- The `id` property (string) uniquely identifies an item within an [ItemCollection]. 
- The `state` property must be a JSON-serializable object.

The SharedState service is agnostic to the internal representation of `state`. The `id` property must be provided by the application. If the `state` element originates from a data model that already includes a unique identifier such as `_id`, `key`, or `uuid`, it may be convenient to reuse this identifier as `item.id`.

### ItemCollection
<a id="itemcollection"></a>

An [ItemCollection] is a collection of [Items] where the `id` of each [Item] is unique within the collection:

```
ItemCollection: ({id_1, state_1}, {id_2, state_2}, ..., {id_n, state_n})
```

The [ItemCollection] allows individual [Items] to be **added**, **removed**, or **replaced** (see [Client API](/client-api/)). Batch updates allow multiple such operations to be performed as one.

### Path
<a id="path"></a>

A server-side [ItemCollection] is uniquely identified by a 3-part [Path]:

```
/app-name/service-name/resource-name
```

* **`app-name`**: The name of the application.
* **`service-name`**: The name of the storage service managing the resource.
* **`resource-name`**: The name of the resource.

While the 3-part [Path] structure is fixed, applications can define an application-specific namespace by introducing delimiters into the `resource-name` component of the [Path]:

```
/myapp/items/room1-chat
/myapp/items/room1_whiteboard
```

* **Forward slashes (`/`) are reserved** for the 3-part path hierarchy (`/app-name/service-name/resource-name`) and cannot be used as delimiters within `resource-name`.
* **Underscores (`_`) or hyphens (`-`) are recommended** as delimiters to avoid collisions with characters used by CSS class selectors (`.`), DOM element IDs (`#`), or pseudo-classes (`:`), making resource names safe to use directly in HTML attributes or CSS queries.

---

## Server-Side ItemCollections

Server-side [ItemCollections] are stored and managed by [ItemStores].

---

## Client-Side ItemCollections

- Client-side [ItemCollections] are JavaScript objects that **mirror** the state of server-side [ItemCollections].
- Application code may **query** the state of a client-side [ItemCollection] and **react** to state changes.
- Client-side [ItemCollections] also serve as **local proxies**, forwarding **update requests** to server-side [ItemCollections].
