
# Shared State

Python server and JavaScript client for real-time data sharing. 


This project provides a Python server and JavaScript client for real-time data
sharing. Shared state implies that multiple (Web) clients may connect to a
shared resource on a server, and maintain a local proxy, which is automatically
kept in sync with the server-side resource. If a client requests modification of
the shared resource, all clients will observe the modification. Importantly,
applications define the data-format for resource and what role resources play in
the application. As such, Share State is a generic tool for state sharing.
Communication between client and server is implemented over websocket
connections.


### Script Downloads

You can download JavaScript bundles directly from the following links:

- [sharedstate.es.js](https://github.com/ingararntzen/shared-state/raw/main/libs/sharedstate.es.js)
- [sharedstate.iife.js](https://github.com/ingararntzen/shared-state/raw/main/libs/sharedstate.iife.js)
- [sharedstate.es.min.js](https://github.com/ingararntzen/shared-state/raw/main/libs/sharedstate.es.min.js)
- [sharedstate.iife.min.js](https://github.com/ingararntzen/shared-state/raw/main/libs/sharedstate.iife.min.js)


### Script Includes

ES6 Module Import 

```html
<script type="module">
    import {SharedStateClient} from "https://github.com/ingararntzen/shared-state/raw/main/libs/sharedstate.es.js";
    const client = new SharedStateClient("ws://host:port");
</script>
```

Import into global variable

```html
<script src="https://github.com/ingararntzen/shared-state/raw/main/libs/sharedstate.iife.js"></script>
<script>
const client = new SHAREDSTATE.SharedStateClient("ws://host:port");
</script>
```


# Server setup

### Database setup

To make use of the built-in mysql support, follow steps below.
Alternatively, create a new service based on a different database.

**Mysql**
```sh
mysql -u root -p 
```

**Mariadb/MySQL 8.x**
```sh
sudo mysql 
```

Create a user and a database.

```sh
create user if not exists myuser@localhost identified by 'mypassword';
create database if not exists sharedstate;
grant all on sharedstate.* to myuser@localhost;
flush privileges;
```

### Server Config

The following config file defines services for the SharedState server.
The service named _items_ is based on MySQl. The second service is named
_mitems_ and is based on an in-memory sqlite database.

```json
{
    "service": {"host": "0.0.0.0", "port": 9000},
    "services": [
        {
            "name": "items", "module": "items_service", 
            "config": {
                "db_type": "mysql",
                "db_name": "sharedstate",
                "db_table": "items",
                "db_host": "localhost",
                "db_user": "myuser",
                "db_password": "mypassord",
                "ssl.enabled": false,
                "ssl.key": null,
                "ssl.ca": null,
                "ssl.cert": null
            }
        },
        {
            "name": "mitems", "module": "items_service", 
            "config": {
                "db_type": "sqlite",
                "db_name": ":memory:",
                "db_table": "items"
            }
        }

    ]
}
```

### Poetry

```sh
poetry install
poetry run sharedstate-server myconfig.json
```


# Concepts

### Collections

The SharedState server hosts named collections of items, and allow
clients to monitor dynamic changes within these collections, including removal,
addition or modifications of items. Communication is multiplexed over a single
websocket connection, even if clients monitor multiple item collections on the
server.


### Items

Items are JSON-serializeable objects with an _"id"_ property.
The _id_ must be a string, and is assumed to be unique within the
collection. Otherwise, applications are free to specify the contents 
of items as needed. 


### Update
Items can be *removed*, *inserted* or *replaced*. Modifications are performed as
a batch operation, allowing the *removal* and *insertion* of multiple items in a
single operation.

```javascript
collection.update({remove:[], insert:[], reset:false}) {}
```

* _remove_ lists _id's_ of items to be removed from the collection. 
Removal is performed ahead of insertion.
* _insert_ is a list of _items_ to be inserted into the collection. Inserted _items_ will replace pre-existing items with same _id_.
* _reset_ (boolean). If true, all pre-existing items will be removed
  ahead of insertion  (_remove_ is ignored).
* defaults for _remove_ and _insert_ is [], implying that they can be
  omitted if there are no items to remove or insert.
* default for _reset_ is false.

| UPDATE ARGUMENT                           | EFFECT                 |
|-------------------------------------------|------------------------|
| {remove:[], insert:[], reset:false}       | NOOP                   |
| {remove:[], insert:[...], reset:false}    | INSERT ITEMS           |
| {remove:[...], insert:[], reset:false}    | REMOVE ITEMS           |
| {remove:[...], insert:[...], reset:false} | REMOVE + INSERT ITEMS  |
| {insert:[], reset:true}                   | RESET                  |
| {insert:[...], reset:true}                | RESET INSERT           |



### Services

The SharedState server provides built-in support for independent 
services responsible for item storage. The default service implementation
is based on MySQL and Sqlite, where Sqlite particularly supports in-memory item
collections. Additional services may be added.


### Paths

Item collections hosted by the SharedState server are identified by a _path_.

```text
/app/service/collection/
```

* app - distinct namespace for each application
* service - name of service
* collection - named item collection  

*collections* and *apps* are automatically created when referenced.  



# Shared State Client

The SharedState client allows application to monitor server-side
collections. The client maintains a local _collection_ for each referenced _path_. This local _collection_ acts as a proxy to the server-side collection, and is automatically synchronized with server-side state changes.
Additionally, the _collection_ provides and update method - which forwards update
requests to the SharedState server.

### Example

The following example shows a minimal application toggling item.data between 
true and false, for a given item within a specific item collection.

```html
<!DOCTYPE html>
<meta charset="utf-8" />
<head>
    <script type="module">
        import {SharedStateClient} from "https://github.com/ingararntzen/shared-state/raw/main/libs/sharedstate.es.js";
        const client = new SharedStateClient("ws://0.0.0.0:9000");

        // Collection
        const coll = client.acquire_collection("/app/items/chnl")

        // Collection Change Handler
        coll.add_callback(function (eArgs) {
            const item = coll.get("myid");
            if (item != undefined) {
                console.log(coll.get("myid").data)
            }
        });

        // Update Button
        document.querySelector("#updateBtn").onclick = () => {
            const item = coll.get("myid");
            if (item != undefined) {
                // toggle data
                coll.update({insert:[{id:"myid", data:!(item.data)}]});
            } else {
                // initialize data
                coll.update({insert:[{id: "myid", data:true}]});
            }
        }
        // Reset Button
        document.querySelector("#resetBtn").onclick = () => {
            coll.update({reset:true});
        }
    </script>
</head>
<body>
    <button id="updateBtn">Update</button>
    <button id="resetBtn">Reset</button>
</body>
</html> 
```

### Proxy Collection

The SharedState client manages local collections serving as proxies to server-side collections.

ProxyCollections may be acquired (and relased) by application code. A released ProxyCollection 
is no longer kept in sync with the corresponding server-side collection, and does no longer accept updates.

```javascript
// acquire
const coll = client.acquire_collection("/myapp/items/mycollection")
// release
client.release("/myapp/items/mycollection");
```

ProxyCollections provide the following methods. 

```javascript
// return a single item, given id
const item = ds.get(id)
// return true if collection has item with id
const ok = ds.has(id)
// return list of all items in collection
const items = ds.get()
// return size of collection
const size = ds.size;
```

ProxyCollection changes reported through callback.
Changes include both membership changes (INSERT, DELETE) and item changes (REPLACE).

```javascript
const handle = ds.add_callback(function (diffs) {
    // handle diffs
});
ds.remove_callback(handle);

// diffs
[
    {id: "id", new: {id, ...}, old: {id, ...}},
    ...
]
```

The callback argument is a list of diffs, one for each items which have
been changed. *new* gives the new state of the item, whereas *old* gives the
state of the item before the update. When a new item has been added, 
*old* is undefined. Similarly, when an item has been remove, *new* is undefined.  

| DIFF                                        | EFFECT   |
|---------------------------------------------|----------|
| {id: "id", new: {id, ...}, old: undefined}  | INSERT   |
| {id: "id", new: {id, ...}, old: {id, ...}}  | REPLACE  |
| {id: "id", new: undefined, old: {id, ...}}  | DELETE   |


### Proxy Objects

The SharedState client also supports ProxyObjects, allowing developers to
work with independent server-side objects in the exact same way they would
work with local objects, that is using set() and get() operations. The only 
distinction from a local variable, is that the set() operation returns a 
Promise, which is resolve only after the set operation has taken effect on
the server. In other words, set() operations are delayed by server round-trip-time, 
just like the update() method of ProxyCollections. The ProxyObject interface 
provides change callbacks like ProxyCollection.

In terms of implementation, a ProxyObject represents a single item within a collection.
Multiple ProxyObjects can be hosted by the same collection. Typically, developers would
set aside one collection which is exclusively reserved for ProxyObjects.

```javascript
const myobj = client.acquire_object("/myapp/items/mycollection", "myobj");

// render value
elem.innerHTML = JSON.stringify(myobj.get());

// set value or JSON serializeable object
myobj.set(obj)

// releases proxy collection and associated proxy objects
client.release("/myapp/items/mycollection");
```

# SharedState Server

Async websocket server.


# Limitations

* Currently, communication is plain text. SSL support has not been tested.

* Currently no support for server-side filtering, though the server design is open to this feature being added as a future extension.

* The provided client code is limited to JavaScript, implying that state sharing is limited the Web platform and nodejs environments. However, the concept itself is open to state sharing across any connected platform, provided only that a client implementation exists for the given platform.