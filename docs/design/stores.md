# Item Stores

In SharedState, the server core decouples network protocol handling, client connections, and subscription dispatching from persistent storage logic. State persistence is delegated to pluggable **ItemStores**.

---

## Store Namespace & Delegation

Every item collection path in SharedState follows a 3-part URL hierarchy:

$$\text{Path} = \text{/app-name/store-name/resource-name}$$

Within this design:

* **Applications (`app`)**: Each `ItemStore` manages state on behalf of multiple distinct applications.
* **Resources (`resource`)**: Within each application, the store maintains multiple isolated resources (item collections).
* **Store Delegation**: When a request targets `/app/store/resource`, `SharedStateServer` routes the request to the `ItemStore` registered under `store-name`. The server never manipulates state directly; it relies on the `ItemStore` interface for all state reads and writes.

---

## 1. Lifecycle Methods

Lifecycle methods manage the instantiation, resource allocation, and graceful teardown of an `ItemStore`.

### `get_store(config)`

* **Purpose**: A module-level factory function that instantiates the `ItemStore` with backend configuration options (e.g. database type, host, credentials, table names, or memory mode).
* **Server Circumstance**: Invoked once during `SharedStateServer` initialization when parsing server configuration files.

### `open()`

* **Purpose**: Asynchronously opens database connections, initializes connection pools, or sets up file handles required for storage operations.
* **Server Circumstance**: Invoked by `SharedStateServer.serve_forever()` during server startup before the server begins accepting network connections.

### `close()`

* **Purpose**: Performs clean teardown by flushing pending transactions and closing active database connection pools or file handles.
* **Server Circumstance**: Invoked by `SharedStateServer.shutdown()` when the server process terminates.

---

## 2. Functional Operations

Functional operations perform the core data retrieval and state mutation tasks required for real-time synchronization.

### `get(app, resource)`

* **Purpose**: Retrieves the full current state snapshot of an item collection for a specified application and resource. The store returns all active items as a list of item dictionaries (`[ {"id": "...", ...}, ... ]`).

* **Server Circumstances**:
  1. **Client Read (`GET` Request)**: When a client issues a WebSocket `REQUEST` with `GET /app/store/resource`, the server calls `store.get(app, resource)` to fetch the current collection snapshot and returns it in a WebSocket `REPLY` message.
  2. **Subscription Resynchronization**: When a client connects or updates its subscription list (`PUT /subs`), the server calls `store.get(app, resource)` for each subscribed path to fetch a fresh state snapshot, which is sent directly to that client as a unicast `NOTIFY` reset message.

### `update(app, resource, changes)`

* **Purpose**: Applies an atomic batch update containing `insert` items, `remove` item IDs, or a `reset` flag to backend storage. The method processes the mutation atomically and returns the effective `changes` dictionary (`{ "insert": [...], "remove": [...], "reset": bool }`).

* **Server Circumstances**:
  1. **Client Mutation (`PUT` Request)**: When a client issues a WebSocket `REQUEST` with `PUT /app/store/resource`, the server calls `store.update(app, resource, changes)` to persist the change in storage.
  2. **Real-time Multicast Notification**: The server takes the effective `changes` dictionary returned by `store.update(...)` and packages it into a `NOTIFY` message. This message is multicasted in real time to all other connected clients currently subscribed to `/app/store/resource`.

---

## 3. Administrative & Introspection Methods

Administrative methods allow the server and external tooling to inspect the structure of stored data without mutating state.

### `apps()`

* **Purpose**: Returns a list of all application names (`app`) currently stored in the backend database.
* **Server Circumstance**: Invoked by HTTP REST endpoints (`GET /api/apps` or `GET /api/stores/{store}/`) to power administrative discovery.

### `channels(app)`

* **Purpose**: Returns a list of all active resource/channel names stored under a specific application.
* **Server Circumstance**: Invoked by HTTP REST inspection endpoints (`GET /api/stores/{store}/{app}`) and the web-based Admin UI explorer.
