[Path]: /design/representation/item_collection#path
[Paths]: /design/representation/item_collection#path
[ItemCollection]: /design/representation/item_collection#itemcollection
[ItemCollections]: /design/representation/item_collection#itemcollection
[Changes]: /design/representation/item_collection#changes

# Communication

> - The SharedState client communicates with the server over HTTP and the WebSocket Protocol.

---


## Server Namespace

The SharedState server defines an internal namespace across WebSocket channels, HTTP REST API endpoints, and static file routes.


### WebSocket Protocol (`ws://host:port/*`)

* **`/resources/*`**: Parent namespace for hosted resources (i.e., [ItemCollections]). Each resource is identified by a [Path], e.g. `/resources/app/store/resource`.
* **`/subs`**: Path to client subscriptions.
* **`/clock`**: Path to server clock.

::: tip Note
The path given in the original HTTP request is ignored for WebSocket connections. Path information is instead provided as part  WebSocket communication.
:::

### HTTP (`http://host:port/*`)
* **`/`** and **`/index.html`** redirect to `/files/adm/index.html`.


### HTTP REST API (`http://host:port/api/*`)

* **`/api/config`**: Server configuration metadata.
* **`/api/stores`**: Registered stores and resource counts.
* **`/api/apps`**: Application trees and resource summary.
* **`/api/subs`**: Active subscriptions overview across all connected clients.
* **`/api/clock`**: UTC timestamp endpoint.
* **`/api/connections`**: Connected clients.

### HTTP Static Assets (`http://host:port/files/*`)

* **`/files/*`**: Static files served from `html/`.
* **`/dist/*`**: Client SDK distribution bundles served from `dist/`.


---


## WebSocket Communication

### Message Types

The SharedState server supports request-reply interactions initiated by clients, and one-way push messages from server to client. The message type is indicated by the `type` field.

* **`REQUEST`**: Message sent by client to request an action with the server.
* **`REPLY`**: Message sent by server in response to a specific `REQUEST`.
* **`MESSAGE`**: Message sent by server to client.

---

### Message Commands

Messages also include a command field to indicate the action associated with the message. The command is indicated by the `cmd` field.

* **`GET`**: Fetching state from the server.
* **`PUT`**: Updating state on the server. 
* **`NOTIFY`**: Updating state on the client.


### Message Serialization

Messages are serialized as stringified JSON objects with the following fields:

* **`type`**: `string` : Message type (`"REQUEST"` | `"REPLY"` | `"MESSAGE"`).
* **`path`**: `string` : Target server path (e.g., `/resources/app/store/resource`, `/subs`, `/clock`).
* **`cmd`**: `string` : Command action (`"GET"` | `"PUT"` | `"NOTIFY"`).
* **`data`**: `any` : Payload data (e.g., [Changes] dictionary or response value). Includes a resource `version` (`number`) on `NOTIFY` updates and state snapshots.
* **`tunnel`**: `object` : Metadata object for request/reply correlation and optimistic write eviction tracking:
  * `client_id` (`string`): Unique identifier of the initiating client.
  * `request_count` (`number`): Monotonically increasing request sequence number for matching replies to requests.
  * `update_count` (`number`): Client-side local update sequence counter used by the $1 + N$ optimistic consistency engine.


### Example Messages

**Subscribe (REQUEST)**

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
  "tunnel": {
    "client_id": "client_abc123",
    "request_count": 1,
    "update_count": 0
  }
}
```

**Subscribe (REPLY)**

```json
{
  "type": "REPLY",
  "cmd": "PUT",
  "path": "/subs",
  "data": [
    ["/resources/app/store/resource-1", {}],
    ["/resources/app/store/resource-2", {}]
  ],
  "tunnel": {
    "client_id": "client_abc123",
    "request_count": 1,
    "update_count": 0
  }
}
```

**Update (REQUEST)**

```json
{
  "type": "REQUEST",
  "cmd": "PUT",
  "path": "/resources/app/store/resource-1",
  "data": {
    "insert": [
      {
        "id": "item-1",
        "state": { "user": "alice", "text": "Hello world!" }
      }
    ]
  },
  "tunnel": {
    "client_id": "client_abc123",
    "request_count": 2,
    "update_count": 5
  }
}
```

**Notify (MESSAGE / Push to Subscribers)**

```json
{
  "type": "MESSAGE",
  "cmd": "NOTIFY",
  "path": "/resources/app/store/resource-1",
  "data": {
    "version": 42,
    "insert": [
      {
        "id": "item-1",
        "state": { "user": "alice", "text": "Hello world!" }
      }
    ]
  },
  "tunnel": {
    "client_id": "client_abc123",
    "request_count": 2,
    "update_count": 5
  }
}
````
