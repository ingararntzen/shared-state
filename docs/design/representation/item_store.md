[Path]: /design/representation/item_collection#path
[Paths]: /design/representation/item_collection#path
[ItemCollection]: /design/representation/item_collection#itemcollection
[ItemCollections]: /design/representation/item_collection#itemcollection
[Changes]: /design/representation/item_collection#changes
[Item]: /design/representation/item_collection#item
[ItemStore]: /design/representation/item_store#itemstore
[ItemStores]: /design/representation/item_store#itemstores
[ItemsStore]: /design/representation/item_store#default-item-store



# Item Store

> The SharedState server hosts [ItemCollections] within [ItemStores].


The SharedState server implements state management through the concept of [ItemStores]. This functionality is decoupled from other server functions, such as the handling of client connections, network communication, and subscription management. This is done to support extensibility of the server, allowing custom storage solutions to be used as backends with the SharedState server. 


**Default Item Store**

The SharedState server provides a default implementation of the [ItemStore] interface, called `ItemsStore` (`sharedstate.stores.item_store`). This module supports simple item collections indexed by ID, and may be configured to support either persistent or in-memory storage. Persistent storage is implemented using MySQL, whereas the in-memory version is backed by SQLite.

**Custom Item Store**

Custom implementations may be realized by creating a Python module implementing the [ItemStore] interface. Typically, this module will wrap an existing storage solution, such as a MySQL or PostgreSQL database. This module may then be imported and registered with the server by adding it to the server configuration.


---

## Item Store Interface


### Module Functions

Python modules implementing the [ItemStore] interface must provide a module-level factory function for the creation of [ItemStore] objects. 

#### `get_store(config)`

```python
def get_store(config: dict | None = None):
    # create item store
    return itemstore
```

* The configuration object is given in the server configuration file.

---

### Namespace Methods

[ItemStores] manage resources on behalf of multiple applications. Resources are identified by a 3-part [Path].

```
/app/store/resource
```

Namespace methods are used by the Admin UI of the SharedState server:


#### `apps()`

```python
async def apps(self):
    return []
```

* Returns (asynchronously) a list of all application names currently managed by the [ItemStore].


#### `resources(app)`

```python
async def resources(self, app: str):
    return []
```

* Returns (asynchronously) a list of all active resource names currently managed under a specific application.


---

### Lifecycle Methods

Lifecycle methods are used by the SharedState server during initialization to open an [ItemStore], and during termination to close it.


#### `open()`

```python
async def open(self):
    pass
```

* Opens (asynchronously) database connections, initializes connection pools, or sets up file handles required for storage operations.


#### `close()`

```python
async def close(self):
    pass
```

* Performs clean teardown (asynchronously) of active database connection pools or file handles.


---

### Resource Methods

Resource methods are used by the SharedState server to fetch or update resource state. Resources correspond to [ItemCollections].


#### `get(app, resource)`

```python
async def get(self, app: str, resource: str):
    return []
```

* Returns (asynchronously) a list of all items in the collection.
* Used by the SharedState server to resolve the initial state whenever a client subscribes to a resource.
 

#### `update(app, resource, changes)`

```python
async def update(self, app: str, resource: str, changes: dict):
    return changes
```

* Requests an update of the resource, as defined by [Changes].
* Returns (asynchronously) the resulting [Changes] after applying the update.
* Used by the SharedState server whenever a client requests an update to a resource.

---
