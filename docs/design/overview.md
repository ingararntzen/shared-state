[Item]: /design/representation/item_collection#item
[Items]: /design/representation/item_collection#item
[ItemCollection]: /design/representation/item_collection#itemcollection
[ItemCollections]: /design/representation/item_collection#itemcollection
[Path]: /design/representation/item_collection#path
[Paths]: /design/representation/item_collection#path
[ItemStore]: /design/representation/item_store
[ProxyCollection]: /design/representation/proxy_collection
[ProxyCollections]: /design/representation/proxy_collection
[ProxyItemCollections]: /design/representation/proxy_collection


# Design Overview

> The SharedState framework facilitates practical, online sharing of application variables and collections.

<figure id="fig-framework-design" style="text-align: center; margin: 2rem 0;">
  <img src="/images/FrameworkDesign.png" alt="SharedState Framework Design Diagram" style="max-width: 100%; height: auto; margin: 0 auto; display: block;" />
  <figcaption style="font-size: 0.9em; opacity: 0.8; margin-top: 0.5rem;">
    <strong>Figure 1:</strong> Framework Design: SharedState Client (top) connected to SharedState Server (bottom).
  </figcaption>
</figure>

---

## SharedState Client

The SharedState Client connects to the SharedState Server in order to **observe** and **modify** shared application resources. Figure 1 organizes client-side concepts in two vertical layers:

- **public** (top layer): concepts central to framework usage. 
- **internal** (bottom layer): concepts central to implementation.

### Internal

- **Proxy ItemCollections** (left box): [ProxyItemCollections] are local, in-memory collections mirroring remote [ItemCollections]. Each [ProxyCollection] is identified by a unique resource [Path].

- **Client Subs** (right box): Client subscriptions list [Paths] to resources currently observed by the client. If [partial resource observation](/concept/architecture#partial-resource-observation) is supported, client subscriptions may additionally include *filters* or *range restrictions* specific to each resource.

### Public

- **Shared Variables & Collections** (left box): Programming abstractions, including single-valued **Variables** (e.g., `Integer`, `Boolean`, `Float`, `String`, `Array`, `Object`) or multi-valued **Collection types** (e.g., `Set`, `List`, `Map`, `Tree`). These concepts are implemented on top of internal [ProxyCollections]. Single-valued **Variables** are backed by individual items within a [ProxyCollection], whereas multi-valued **Collection types** each correspond to a distinct [ProxyCollection].

- **Connection** (center box): The connection object represents the status of the underlying WebSocket connection. Applications may use this to access connection status, or to implement appropriate actions when the connection transitions between states.

- **Clock** (right box): Clock represents a live approximation of the system time of the SharedState Server, and may be used as a shared, synchronized wall clock.

---

## SharedState Server

The SharedState Server allows connected clients to **observe** and **modify** shared resources. Figure 1 organizes server-side concepts in two vertical layers:

- **public** (top layer): concepts central to the public interface of the server. 
- **internal** (bottom layer): concepts central to implementation.

### Internal

- **ItemCollection Stores** (left disks): Resource [Paths] identify [ItemCollections] within [ItemStores]. By default, the server provides two [ItemStore] implementations: one persistent store (MySQL) and one in-memory store (SQLite). The SharedState Server may be configured to use custom store implementations.

- **Clients & Subs** (right box): The SharedState Server maintains an in-memory registry of connected clients and their subscriptions.

### Public

- **WS Server** (right box): The WebSocket server implements core functionality of the SharedState Server, which can be divided into three parts:
  1. **Client Management**: Handling client connections, disconnections, and client requests to subscribe or unsubscribe from resources.
  2. **State Management**: Handling client requests for state initialization, state modification, and change notification. This is performed in accordance with active subscription states and involves both read and write operations on [ItemStores].
  3. **Clock Estimation**: Handling client requests for sampling the server clock.

- **HTTP Server** (right box): The HTTP server serves static files and provides access to server status through a [REST API](/design/mechanism/communication#server-namespace).
