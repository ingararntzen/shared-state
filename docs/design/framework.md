[Item]: /design/resources.md#item
[Items]: /design/resources.md#item
[ItemCollection]: /design/resources.md#itemcollection
[ItemCollections]: /design/resources.md#itemcollection
[Path]: /design/resources.md#path
[Paths]: /design/resources.md#path
[ItemStore]: /design/stores
[ItemStores]: /design/stores

# Design Overview

> The SharedState framework facilitates practical, online sharing of application entities such as variables and collections.

<figure id="fig-framework-design" style="text-align: center; margin: 2rem 0;">
  <img src="/images/FrameworkDesign.png" alt="SharedState Framework Design Diagram" style="max-width: 100%; height: auto; margin: 0 auto; display: block;" />
  <figcaption style="font-size: 0.9em; opacity: 0.8; margin-top: 0.5rem;">
    <strong>Figure 1:</strong> Framework Design: SharedState Client (top) connected to SharedState Server (bottom).
  </figcaption>
</figure>

---

## SharedState Client

The SharedState Client connects to the SharedState Server in order to **observe** and **modify** shared application resources. Figure 1 organizes client-side concepts in two vertical layers:

- **public** (top layer): concepts central to the public interface of the client. 
- **internal** (bottom layer): concepts central to its implementation.

### Internal

- **Proxy ItemCollections** (left box): Proxy ItemCollections are local, in-memory [ItemCollections] mirroring [ItemCollections] hosted by the server. Each [ItemCollection] is identified by a unique resource [Path].

- **Client Subs** (right box): Client subscriptions list all resource [Paths] currently observed by the client. If [partial resource observation](/concept/architecture#partial-resource-observation) is supported, client subscriptions may additionally include *filters* or *range restrictions* specific to each resource.

### Public

- **Proxy Objects** (left box): Proxy objects represent high-level application objects like single-valued variables (e.g., `Integer`, `Boolean`, `Float`, `String`, `Array`, `Object`) or multi-valued data structures (e.g., `Set`, `List`, `Map`, `Tree`). These concepts are implemented on top of [ItemCollections]. Single-valued variables are all backed by the same [ItemCollection], whereas multi-valued data structures each correspond to a separate [ItemCollection].

- **Connection** (center box): The connection object represents the status of the underlying WebSocket connection. Applications may use this to implement appropriate actions as the connection goes offline or online.

- **Clock** (right box): Clock represents a live approximation of the system time of the SharedState Server, and may be used as a shared, synchronized wall clock across all clients of an application.

---

## SharedState Server

The SharedState Server allows connected clients to **observe** and **modify** shared resources. Figure 1 organizes server-side concepts in two vertical layers:

- **public** (top layer): concepts central to the public interface of the server. 
- **internal** (bottom layer): concepts central to its implementation.

### Internal

- **ItemCollection Stores** (left disks): Resource [Paths] identify [ItemCollections] within [ItemStores]. By default, the server provides two [ItemStore] implementations: one persistent store (MySQL) and one in-memory store (SQLite). The SharedState Server may be configured to use custom implementations.

- **Clients & Subs** (right box): The SharedState Server maintains an in-memory registry of connected clients and their subscriptions.

### Public

- **WS Server** (right box): The WebSocket server implements core functionality of the SharedState Server, which can be divided into three parts:
  1. **Client Management**: Handling client connections, disconnections, and client requests to subscribe or unsubscribe from resources.
  2. **State Management**: Handling client requests for state initialization, state modification, and change notification. This is performed in accordance with active subscription states and involves both read and write operations on [ItemStores].
  3. **Clock Estimation**: Handling client requests for sampling the server clock.

- **HTTP Server** (left box): The HTTP server performs the following functions:
  1. **`/`**: Serve static web assets.
  2. **`/ws`**: Redirect WebSocket traffic to the `WS Server`.
  3. **`/api`**: Serve a REST API for status reporting (JSON).
  4. **`/adm`**: Serve an administrative web interface for viewing (and clearing) Item Collections.
