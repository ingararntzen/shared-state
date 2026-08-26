# Client Proxy Collection

A **Proxy Item Collection** (`ProxyCollection`) is the client-side Layer 1 proxy representing a server-side Item Collection over WebSockets.

---

## Role in Architecture

`ProxyCollection` maintains a local in-memory replica of an Item Collection resource (`Map<id, item>`) and manages real-time synchronization with the SharedState server.

```
+-------------------------------------------------------------+
|                Layer 2 Domain Abstractions                   |
| (SharedInteger, SharedBool, SharedMap, SharedSet)           |
+-------------------------------------------------------------+
                              | (provider)
                              v
+-------------------------------------------------------------+
|                 Layer 1 ProxyCollection                     |
|  - Manages local Map<id, item>                              |
|  - Batches updates via internal UpdateBuilder               |
|  - Emits item diff notifications to observers               |
+-------------------------------------------------------------+
                              | (WebSocket JSON)
                              v
+-------------------------------------------------------------+
|                     SharedState Server                      |
+-------------------------------------------------------------+
```

---

## Core Operations

### 1. In-Memory Local Querying
`ProxyCollection` supports synchronous local inspection:
- `size`: Returns total item count in local state.
- `has_item(id)`: Returns boolean indicating whether item `id` exists.
- `get_item(id)`: Returns stored item object or `undefined`.
- `get_items()`: Returns an array snapshot of all stored items.

### 2. Microtask Batch Updating (`UpdateBuilder`)
Calls to `update_items(changes)` perform microtask batching:
- Synchronous calls to `update_items({ insert, remove, reset })` during the same event loop execution frame are aggregated into an internal `UpdateBuilder`.
- Multiple insertions for the same `id` within the microtask overwrite previous ones.
- A single `queueMicrotask()` is scheduled, dispatching **one single WebSocket request** (`PUT`) to the server.
- All callers during the microtask receive the same shared `Promise` instance.

### 3. Server Notification Handling
When the server sends a `NOTIFY` message for the collection's path:
- `_ssclient_update(changes)` applies effective `insert`, `remove`, and `reset` changes to the local `Map`.
- Registered observer callbacks are invoked with the exact effective change diff.
