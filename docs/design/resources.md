[Item]: #item
[Items]: #item
[ItemCollection]: #itemcollection
[ItemCollections]: #itemcollection
[Path]: #path
[Paths]: #path

# Resources
<a id="resource"></a>


> - The SharedState service hosts **resources** on behalf of applications.
> - **Resources** are [ItemCollections] identified by [paths].



Resources may represent a variety of application entities, including `string`, `number`, `boolean`, `object`, or `array`, or more advanced data structures such as `Set`, `Map`, `List`, `Tree`, or `Track`. 

The SharedState service provides persistent **storage** for resources, and allow clients to **update** and **observe** resources in real time.  

Importantly, the SharedState service is agnostic to the internal representation of resources, viewing them all as [ItemCollections]. Client applications can freely define resource names and representations as needed, and implement higher level abstractions on top of this basic server-side representation. 


---

## Item
<a id="item"></a>

An [Item] is a thin wrapper around some element of application state:

```
Item : {id, state}
```

- The `id` property (string) uniquely identifies an item within an [ItemCollection]. 
- The `state` property must be a JSON serializeable object.

The SharedState service is agnostic to the internal representation of `state`. The 'id' property ust be provided by the application. If the `state` element originates from a data model that already includes a unique identifier such as `_id``, `key`, or `uuid`, it may be convenient to reuse this indentifier as `item.id`.

---

## ItemCollection
<a id="itemcollection"></a>

An [ItemCollection] is a collection of [Items] where the `id` of each [Item] is unique within the collection.

```
ItemCollection: ({id_1, state_1}, {id_2, state_2}, ..., {id_n, state_n})
```


[ItemCollection] allows individual [Items] to be **added**, **removed**, or **replaced**. Batch updates allow multiple such operations to be performed as one.

---

## Application Entities

[ItemCollection] may serve as a common basis for representation of different application entities.

* Single-valued variables, such as `string`, `number`, or `object` can be represented by a single [Item] within an [ItemCollection].
* Mutable collections, such as `Set` or `Map` can be directly represented by a single [ItemCollection].
* More advanced data structured, such as `List`, `Tree`, or `Track` may be implemented on top of [ItemCollections].


---

## Path
<a id="path"></a>

Every server-side resource is uniquely referenced by a 3-part [Path}. The SharedState service does not provide explicit operations for manipulating the namespece. Instead, the namespace is implicitly defined by the existence of resources associated with paths, similar to a local dictionary.

```
/app-name/service-name/resource-name
```

* **`app-name`**: The name of the application.
* **`service-name`**: The name of the storage service managing the resource.
* **`resource-name`**: The name of the resource.

