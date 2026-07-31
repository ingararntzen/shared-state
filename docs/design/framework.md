# SharedState Framework Design

> The SharedState system connects client-side proxies to server-hosted storage services over a single network connection.

---

## Architectural System Overview

The diagram below illustrates the end-to-end component structure of the SharedState framework:

<figure id="fig-framework-design" style="text-align: center; margin: 2rem 0;">
  <img src="/images/FrameworkDesign.png" alt="SharedState Framework Design Diagram" style="max-width: 100%; height: auto; margin: 0 auto; display: block;" />
  <figcaption style="font-size: 0.9em; opacity: 0.8; margin-top: 0.5rem;">
    <strong>Figure 1:</strong> Framework Design: SharedState Client (top) connected to SharedState Server (bottom).
  </figcaption>
</figure>

---

## Concept Map & System Components

### 1. `SharedStateClient`
The client-side entry point that establishes the WebSocket connection, manages request-reply multiplexing, and hosts local proxy objects ([Proxies](/design/proxies.md)).

### 2. Client Subscriptions
A local registry maintained by `SharedStateClient` mapping resource paths to active proxy instances (`ProxyCollection` or `ProxyObject`), routing server notification payloads directly to local proxies ([Subscriptions](/design/subscriptions.md)).

### 3. Client Proxies (`ProxyCollection` & `ProxyObject`)
Local in-memory replicas of online server resources. Proxies provide synchronous zero-latency local queries and handle state updates asynchronously over the network ([Proxies](/design/proxies.md)).

### 4. Server Interfaces (`WebSocketServer` & `HttpServer`)
The server exposes a unified single-port listener (default port `9000`). Incoming WebSocket connections handle real-time commands (`GET`, `PUT`, `NOTIFY`), while HTTP handles REST admin endpoints and static asset serving ([Messages](/design/websocket.md)).

### 5. In-Memory Server Subscriptions
A lightweight server registry tracking active client connections (`ws`) and their subscribed resource paths, enabling targeted multicast notifications whenever a resource updates ([Subscriptions](/design/subscriptions.md)).

### 6. Storage Services Rack
A modular backend service manager routing resource operations to pluggable storage implementations based on the `service-name` component of the path (`items`, `sqlite`, `mysql`) ([Stores](/design/stores.md)).

### 7. Resources & Item Collections
The fundamental server-hosted data unit. Every resource is an `ItemCollection` of `(id, state)` items identified by a 3-part path (`/app-name/service-name/resource-name`) ([Resources](/design/resources.md)).
