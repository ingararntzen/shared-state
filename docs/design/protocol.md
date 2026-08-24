[Path]: /design/collections#path
[Paths]: /design/collections#path
[ItemCollection]: /design/collections#itemcollection
[ItemCollections]: /design/collections#itemcollection

# Communication

> - The SharedState client exchanges messages with the server across an open WebSocket connection.


---

## Message Types

The SharedState server supports request-reply interaction across from the client, as well as one-way push messages from server to client. The message type is indicated by the `type` field.

* **`REQUEST`**: Message sent by client to request an action with the server.
* **`REPLY`**: Message sent by server in response to a specific `REQUEST`.
* **`MESSAGE`**: Message sent by server to clients, to broadcast state changes.

---

## Message Commands

Messages also include a command field to indicate the action associated with the message. The command is indicated by the `cmd` field.

* **`GET`**: Fetching state from the server.
* **`PUT`**: Updating state on the server. 
* **`NOTIFY`**: Updating state on the client, after state change on server.

## Server Namespace

Resources on the SharedState server are identified by a `server path`, indicated by the `path` field. Notably, the server does not only host application resources (i.e. [ItemCollections]), but defines a namespace including multiple resource types:

* **/**: Stores
* **/subs**: Active subscriptions
* **/clock**: Server clock
* **/api/config**: Server configuration
* **/adm/**: Server files
* **/dist/**: SharedState client code







## Message Serialization

Messages are currently serialized as stringified JSON objects, with the following fields:

* **`type`**: `str` : message type `("REQUEST"|"REPLY"|"MESSAGE")`
* **`cmd`**: `str` : command `("GET"|"PUT"|"NOTIFY")`
* **`path`**: `str`: path `/apps/app/store/resource`
* **`arg`**: `dict` : arguments
* **`tunnel`**: `int` : request / reply identifier

Note that resource paths `/app/store/resource` are prefixed with `/resource


follow the [ResourcePaths](/design/collections#path) definition.


---

## Client-side Communication

- **send/onreceive**
- **request/reply -> promise** and server side support.


- get("GET")
- update("PUT")

- subs()
- unsub()


---

## Server-side Communication

- service requests
- change notifications notifications
- initial state (begin/end?)



---

## Example Session: 


### Subscribe # Initial State


```
Client A                   Server                   Client B
   │                         │                         │
   ├── PUT /myapp/items ────►│                         │
   │   (REQUEST, tunnel: 1)  ├── Commit Batch          │
   │                         ├── NOTIFY /myapp/items ─►│
   │◄── REPLY (ok: true) ────┤   (MESSAGE)             │
   │    (tunnel: 1)          │                         │
```


### Update & Broadcast

```
Client A                   Server                   Client B
   │                         │                         │
   ├── PUT /myapp/items ────►│                         │
   │   (REQUEST, tunnel: 1)  ├── Commit Batch          │
   │                         ├── NOTIFY /myapp/items ─►│
   │◄── REPLY (ok: true) ────┤   (MESSAGE)             │
   │    (tunnel: 1)          │                         │
```

---

## Example Messages


### 1. Reset Subscriptions (`PUT /subs`)

Whenever subscriptions change—or when a client reconnects—the client posts its complete active subscription set to `/subs` as a single batch update:

```json
{
  "type": "REQUEST",
  "cmd": "PUT",
  "path": "/subs",
  "arg": {
    "insert": [
      ["/myapp/items/room1-chat", {}],
      ["/myapp/items/config", {}]
    ],
    "reset": true
  },
  "tunnel": 0
}
```

### 2. ping

- request and reply


### 3. update

- request, notification, reply

```json
{
  "type": "REQUEST",
  "cmd": "PUT",
  "path": "/myapp/items",
  "arg": {
    "insert": [
      ["/myapp/items/room1-chat", {}],
      ["/myapp/items/config", {}]
    ],
    "reset": true
  },
  "tunnel": 0
}
```


---