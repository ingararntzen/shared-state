[Item]: #item
[Items]: #item
[ItemCollection]: #itemcollection
[ItemCollections]: #itemcollection
[Path]: #path
[Paths]: #path

# Resources
<a id="resource"></a>


> - The SharedState service hosts named resources on behalf of applications.

Resources may represent values of any type, such as **string**, **number**, **boolean**, **objects**, or **arrays**, or state backing more advanced data types such as **sets**, **maps**, **trees**, or **tracks**. 

The SharedState service provides support for **storage**, **observation**, and realtime **updates** across all hosted resources.  

Importantly, SharedState is agnostic to the internal representation of resources, viewing them all as [ItemCollections]. 

Client applications can freely define resource names and representations as needed, and implement higher level abstractions on top of [ItemCollections].

Moreover, namespaces on the SharedState server are implicitly created by creating resources on paths, similar to a local dictionary.

For an overview see [SharedState Architecture](/design/architecture.md).

---

# Item
<a id="item"></a>

An **Item** is a thin wrapper around an element of application state, represented as a key-value pair:

```
{id, state}
```

The `id` property uniquely identifies an item within an **ItemCollection**. If `state` already includes a unique identifier such as **id**, **key**, or **uuid**, this property may be used as `item.id`. Otherwise, a new `id` must be generated.

The `state` property holds application resources. SharedState places no constraints on the representation of `state`, other than requiring that `state` is JSON-serializable. 

---

# ItemCollection
<a id="itemcollection"></a>

An **ItemCollection** is a collection of items, where each item is uniquely identified by its `id`.

[ItemCollection] allows individual [Items] to be **added**, **removed**, or **replaced**. Multiple such update operations may also be performed as one atomic batch operation, see [Update](/design/update.md).

---

# Resource Representation

> - The SharedState service manages **resources** identified by [paths]. 
> - All **resources** are [ItemCollections].

[ItemCollection] may serve as a common basis for representation of different resource types.

* Single-valued resources, such as **string**, **float**, or **object** can be represented by an [Item] within an [ItemCollection].
* Mutable collection types, such as **Set** or **Map** are naturally represented as [ItemCollections].
* More structured types such as **List**, **Tree**, or **Track** may be realized on top of [ItemCollections].


---

# Resource Path
<a id="path"></a>

Every server-side resource is uniquely referenced by a 3-part path. The SharedState service does not provide explicit operations for manipulating the namespece. Instead, the namespace is implicitly defined by the existence of resources associated with paths, similar to a local dictionary.

```
/app-name/service-name/resource-name
```

* **`app-name`**: The name of the application.
* **`service-name`**: The name of the storage service managing the resource.
* **`resource-name`**: The name of the resource.

---

# Alternative Service Implementations

Alternative service implementations may offer custom indexing over items within an item collection.

For example, specialized backend services can introduce timestamp `ts` or interval `itv` indexing to support efficient time-based range queries and range subscriptions over historical event logs or time-series data.

For more information on service backends, see [Services](/design/services.md).
