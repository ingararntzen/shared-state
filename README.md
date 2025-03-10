
# SharedState Server

Python server and JavaScript client for real-time data sharing. 
Communication between client and server is currently plain text 
over websocket connections.

The server hosts named collections of items, and allow clients
to monitor dynamic changes within these collections, including
removal, addition or modifications of items. Communication
is multiplexed over a single websocket connection, even if
clients monitor multiple item collections on the server.


### Python virtual environment setup

Python version >= 3.7

```sh
# create venv sharedstate
python3.8 -m venv sharedstate
# activate venv
source venv/bin/activate
pip install --upgrade pip
# install package
pip install .
# start server
sharedstate myconfig.json
```

### Item Collections

Items are JSON-serializeable objects with an _id_ property.
The _id_ must be a string, and is assumed to be unique within the
collection. Otherwise, applications are free to specify the contents 
of items as needed. Modifications are performed as a batch operation,
possibly specifying the removal, insertion or replacement of multiple
items in a single operation.

```javascript
collection.update({remove:[], insert:[], reset:false}) {}
```

* _remove_ lists the _id_ of items to be removed from the collection. 
Removal is performed ahead of insertion.
* _insert_ is a list of _items_ to insert into the collection. Inserted _items_
will replace pre-existing items with same _id_.
* _reset_ is a boolean flag. If true, all pre-existing items will be removed
  ahead of insertion  (_remove_ is ignored).


|-------------------------------------------|------------------------|
| UPDATE ARGUMENT                           | EFFECT                 |
|-------------------------------------------|------------------------|
| {remove:[], insert:[], reset:false}       | NOOP                   |
| {remove:[], insert:[...], reset:false}    | INSERT ITEMS           |
| {remove:[...], insert:[], reset:false}    | REMOVE ITEMS           |
| {remove:[...], insert:[...], reset:false} | REMOVE + INSERT ITEMS  |
|-------------------------------------------|------------------------|
| {insert:[], reset:true}                   | RESET                  |
| {insert:[...], reset:true}                | RESET INSERT           |
|-------------------------------------------|------------------------|


### Services

The SharedState server provides built-in support for multiple logical 
services responsible for item storage. The default service implementation
is based on MySQL or Sqlite, where Sqlite particularly supports in-memory item
collections. The setup of services is defined in the config file (JSON).

For example, the following config file defines one service named _items_ based on MySQl,
and another named _mitems_ based on an in-memory sqlite database.  

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
                "db_password": "mypassord"
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

Importantly, SharedState service may be extended with alternative service implementations
over other databases if needed. 


### Paths
Item collections hosted by the SharedState server are identified by a _path_.

```text
/app/service/collection/
```

* app - distinct namespace for each application
* service - name of service
* collection - named item collection  

Collections and apps are automatically created when referenced.  


### Example MySQL Database setup

To make use of the built-in mysql support, follow steps below.
Alternatively, create a new service based on a different database.

**Mysql**
```sh
mysql -u root -p 
```

**Mariadb**
```sh
sudo mysql 
```

```sh
create user if not exists myuser@localhost identified by 'mypassword';
create database if not exists sharedstate;
grant all on sharedstate.* to myuser@localhost;
flush privileges;
```

# SharedState Client

The SharedState client allows application code to monitor service-side items collection.
The client maintains a local _dataset_ for each referenced _path_, and ensures that
the _dataset_ is always synchronized with state changes in server-side item collections. 
Additionally, the _dataset_ provides and update method - forwarding update requests to
the SharedState server.


### Example

The following example shows a minimal application toggling item.data between 
true and false, for a given item within a collection *"/myapp/items/mycollection"*


```html
<!DOCTYPE html>
<meta charset="utf-8" />
<head>
    <script type="module">
        import {SharedStateClient} from "./js/sharedstate.es.js";
        const client = new SharedStateClient("ws://0.0.0.0:9000");
        client.connect();

        // Dataset
        const [handle, ds] = client.acquire("/myapp/items/mycollection")

        // Dataset Change Handler
        ds.add_callback(function (eArgs) {
            const item = ds.get_item("myid");
            if (item != undefined) {
                console.log(ds.get_item("myid").data)
            }
        });

        // Update Button
        document.querySelector("#updateBtn").onclick = () => {
            const item = ds.get_item("myid");
            if (item != undefined) {
                // toggle data
                ds.update({insert:[{id:"myid", data:!(item.data)}]});
            } else {
                // initialize data
                ds.update({insert:[{id: "myid", data:true}]});
            }
        }
        // Reset Button
        document.querySelector("#resetBtn").onclick = () => {
            ds.update({reset:true});
        }
    </script>
</head>
<body>
    <button id="updateBtn">Update</button>
    <button id="resetBtn">Reset</button>
</body>
</html> 
```

### Acquire Release

Applications may acquire and release a dataset. A realeased dataset is
no longer kept in sync with corresponding collection on the server.
Datasets will only be released when all handles have been released.

```javascript
// acquire
const [handle, ds] = client.acquire("/myapp/items/mycollection")
// release
client.release(handle);
```


### Dataset

Dataset provides the following methods for access to. 

```javascript
// return a single item, given id
const item = ds.get_item(id)
// return true if dataset has item with id
const ok = ds.has_item(id)
// return list of all items in dataset
const items = ds.get_items()
// return size of dataset
const size = ds.size;
```

Dataset reports changes through callback

```javascript

const handle = ds.add_callback(function (diffs) {
    // handle diffs
});
ds.remove_callback(handle);

// diffs
[
    {id: "id", new: {id, ...}, old: {id, ...}}
]

```

The callback argument is a list of diffs, one for each items which have
been changed. *new* gives the new state of the item, whereas *old* gives the
state of the item before the update. When a new item has been added, 
*old* is undefined. Similarly, when an item has been remove, *new* is undefined.  

|---------------------------------------------|----------|
| DIFF                                        | EFFECT   |
|---------------------------------------------|----------|
| {id: "id", new: {id, ...}, old: undefined}  | INSERT   |
| {id: "id", new: {id, ...}, old: {id, ...}}  | REPLACE  |
| {id: "id", new: undefined, old: {id, ...}}  | DELETE   |
|---------------------------------------------|----------|













