[Path]: /design/item_collections/item_collection#path
[Paths]: /design/item_collections/item_collection#path
[ItemCollection]: /design/item_collections/item_collection#itemcollection
[ItemCollections]: /design/item_collections/item_collection#itemcollection
[Changes]: /design/item_collections/item_collection#changes

# Communication

> - The SharedState client communicates with the server over HTTP and the WebSocket Protocol.

---


## Server Namespace

The SharedState server defines an internal namespace across WebSocket channels, HTTP REST API endpoints, and static file routes.


### WebSocket Protocol (`ws://host:port/*`)

* **`/resources/*`**: Parent namespace for all resources. Individual resources are identified by appending the resource's [Path], e.g. `/resources/app/store/resource`.
* **`/subs`**: Path to client subscriptions.
* **`/clock`**: Path to server clock.

> - The original HTTP request path is ignored. Path information is instead provided in messages.


### HTTP Root Namespace (`http://host:port/*`)
* **`/`** and **`/index.html`** redirect to `/files/adm/index.html`, 


### HTTP REST API (`http://host:port/api/*`)

* **`/api/config`**: Server configuration metadata.
* **`/api/stores`**: Registered stores and resource counts (`/api/stores/{store}/{app}`).
* **`/api/apps`**: Application trees and resource summary (`/api/apps/{app}/{store}`).
* **`/api/subs`**: Active subscriptions overview across all connected clients.
* **`/api/clock`**: HTTP GET UTC timestamp endpoint.
* **`/api/connections`**: Active client remote IP addresses.

### HTTP Static Assets (`http://host:port/files/*`)

* **`/files/*`**: Static files served directly from `html/` (e.g. `/files/adm/index.html`, `/files/demo.html`, `/files/minimal.html`).
* **`/dist/*`**: Client SDK distribution bundles served directly from `dist/` (e.g. `/dist/sharedstate.es.js`).


---


## WebSocket Communication

### Message Types

The SharedState server supports request-reply interaction across from the client, as well as one-way push messages from server to client. The message type is indicated by the `type` field.

* **`REQUEST`**: Message sent by client to request an action with the server.
* **`REPLY`**: Message sent by server in response to a specific `REQUEST`.
* **`MESSAGE`**: Message sent by server to clients, to broadcast state changes.

---

### Message Commands

Messages also include a command field to indicate the action associated with the message. The command is indicated by the `cmd` field.

* **`GET`**: Fetching state from the server.
* **`PUT`**: Updating state on the server. 
* **`NOTIFY`**: Updating state on the client, after state change on server.


### Message Serialization

Messages are serialized as stringified JSON objects, with the following fields:

* **`type`**: `str` : message type (`"REQUEST"` | `"REPLY"` | `"MESSAGE"`)
* **`path`**: `str`: server path (e.g., `/resources/app/store/resource`, `/subs`, `/clock`)
* **`cmd`**: `str` : command (`"GET"` | `"PUT"` | `"NOTIFY"`)
* **`data`**: `any` : message payload (e.g., [Changes] dict or return value)
* **`tunnel`**: `int` : request / reply tracking identifier


### Example Messages

**Subscribe**

```json
{
  "type": "REQUEST",
  "cmd": "PUT",
  "path": "/subs",
  "data": {
    "insert": [
      ["/resources/app/store/resource-1", {}],
      ["/resources/app/store/resource-2", {}]
    ],
    "reset": true
  },
  "tunnel": 0
}
```

**Update**

```json
{
  "type": "REQUEST",
  "path": "/resources/app/store/resource-1",
  "cmd": "PUT",
  "data": {
    "insert": [
      {
        "id": "item-1",
        "state": { "user": "alice", "text": "Hello world!" }
      }
    ]
  },
  "tunnel": 1
}
```


**Notify**

```json
{
  "type": "MESSAGE",
  "path": "/resources/app/store/resource-1",
  "cmd": "NOTIFY",
  "data": {
    "insert": [
      {
        "id": "item-1",
        "state": { "user": "alice", "text": "Hello world!" }
      }
    ]
  }
}
````
