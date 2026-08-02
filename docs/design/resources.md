[Item]: #item
[Items]: #item
[Path]: #path
[Paths]: #path
[ItemCollection]: #itemcollection
[ItemCollections]: #itemcollection
[ItemStore]: /design/store
[ItemStores]: /design/store
[SharedState Client]: /design/framework#sharedstate-client
[SharedState Server]: /design/framework#sharedstate-server


# Resource Representation

> - The [SharedState Server] hosts [ItemCollections] identified by [Paths].
> - The [SharedState Client] mirrors server-side [ItemCollections] locally. 


---

## Application Resources

The SharedState framework facilitates sharing of low-level application resources, such as `string`, `number`, `boolean`, `object`, or `array`, or more advanced data structures such as `Set`, `Map`, `List`, or `Tree`. Importantly, the SharedState framework does not provide specific solutions for each of these types, but rather provides a generic state sharing mechanism as a common basis for all these resource types (see [Replication Strategy](/concept/replication)).

---

## Unit of State Sharing

The SharedState framework facilitates sharing of [ItemCollections].

- The [SharedState Server] hosts [ItemCollections] identified by [Paths].
- The [SharedState Client] mirrors server-side [ItemCollections] and make them available at the client-side as local proxy objects. 


---


## Definitions


### Item
<a id="item"></a>

- An [Item] is a thin wrapper around some element of application state:

```
Item : {id, state}
```

- The `id` property (string) uniquely identifies an item within an [ItemCollection]. 
- The `state` property must be a JSON serializeable object.

The SharedState service is agnostic to the internal representation of `state`. The 'id' property ust be provided by the application. If the `state` element originates from a data model that already includes a unique identifier such as `_id``, `key`, or `uuid`, it may be convenient to reuse this indentifier as `item.id`.


### ItemCollection
<a id="itemcollection"></a>

- An [ItemCollection] is a collection of [Items] where the `id` of each [Item] is unique within the collection.


```
ItemCollection: ({id_1, state_1}, {id_2, state_2}, ..., {id_n, state_n})
```

- The [ItemCollection] allows individual [Items] to be **added**, **removed**, or **replaced**. Batch updates allow multiple such operations to be performed as one.



### Path
<a id="path"></a>

A server-side [ItemCollection] is uniquesly identified by a 3-part [Path].

```
/app-name/service-name/resource-name
```

* **`app-name`**: The name of the application.
* **`service-name`**: The name of the storage service managing the resource.
* **`resource-name`**: The name of the resource.

While the 3-part [Path] structure is fixed, applications can define an application specific namespace by introducing delimiters into the `resource-name` component of the [Path].

```
/myapp/items/room1-chat
/myapp/items/room1_whiteboard
```

* **Forward slashes (`/`) are reserved** for the 3-part path hierarchy (`/app-name/service-name/resource-name`) and cannot be used as delimiters within `resource-name`.
* **Underscores (`_`) or hyphens (`-`) are recommended** as this avoids collisions with characters used by CSS class selectors (`.`), DOM element IDs (`#`), or pseudo-classes (`:`), making resource names safe to use directly in HTML attributes or CSS queries.


---

## Server-side ItemCollections

Server-side [ItemCollections] are hosted by [ItemStores].

---

## Client-side ItemCollections

- Client-side [ItemCollections] are **JavaScript** objects that **mirror** the state of a server-side [ItemCollections].
- Application code may **query** the state of client-side [ItemCollection] and **react** to changes.
- Client-side [ItemCollections] also serve as **local proxies**, forwarding **update** reqquest to server-side [ItemCollections]

---

