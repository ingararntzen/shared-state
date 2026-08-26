# Consistency & Sequencing Mechanisms

SharedState incorporates a set of client and server sequencing mechanisms designed to ensure deterministic state replication, optimistic concurrency control, and real-time consistency across multi-client environments.

---

## Architecture Overview

To support high-frequency client edits, microtask batching, and concurrent multi-client updates without UI flicker or out-of-order race conditions, SharedState relies on five key building blocks:

| Mechanism | Maintained By | Scope | Purpose |
| :--- | :--- | :--- | :--- |
| **Server Resource Version** | Server | Per Resource (`app, store, resource`) | Global update ordering and Optimistic Concurrency Control (OCC). |
| **Server Tunneling** | Server | Per Message (`REQUEST`, `REPLY`, `NOTIFY`) | Payload-agnostic pass-through of client metadata across network. |
| **Client ID (`client_id`)** | Client | Per Client Instance | Distinguishes local client edits from remote client updates. |
| **Request Counter (`request_count`)** | Client | All WebSocket Requests | Matches WebSocket `REQUEST` messages to client Promise resolvers. |
| **Update Counter (`_last_requested_update_count`)** | Client | Resource Update Operations | Sequences collection mutations for optimistic overlay tracking and dropped-request detection. |

---

## Building Blocks

### 1. Server Resource Version (`version`)
Maintains a global, monotonically increasing integer version counter on the server for each individual resource (`(app, store_name, resource_name)`).
- Starts at `0` upon server initialization and increments on every accepted mutation (`version++`).
- Included in every `NOTIFY` broadcast and unicast subscription `reset` message.

### 2. Server Tunneling (`tunnel`)
Allows clients to attach custom tracking metadata (`tunnel` object) to outgoing `REQUEST` messages, which the server echoes back in `REPLY` messages, multicast `NOTIFY` update broadcasts, and unicast subscription `reset` snapshots.
- The server is payload-agnostic regarding `tunnel`. It preserves the exact JSON structure provided by the originating client and routes it to all subscribed clients.
- `tunnel` metadata is used strictly for internal client sequencing and is **omitted from public change callback payloads** to keep application code unpolluted.

### 3. Client ID (`client_id`)
Distinguishes updates originating from the local client instance from updates made by remote clients.
- Generated as a 12-character unique random string when `SharedStateClient` is initialized.
- Carried in `tunnel.client_id`.

### 4. Request Counter (`request_count`)
Resolves asynchronous JavaScript `Promise` instances for WebSocket request/reply cycles.
- Monotonically incremented on **every** WebSocket request sent by `SharedStateClient` (`GET /clock`, `PUT /subs`, `PUT /resources/*`).
- Passed in `tunnel.request_count`.

### 5. Update Counter (`client._last_requested_update_count`)
Sequences collection update operations (`update_items`) for detecting dropped network requests and providing the foundation for speculative client-side overlays.
- Monotonically incremented **only on dispatch of update requests** (`update_items`).
- Carried in `tunnel.update_count`. In non-update requests (e.g. `PUT /subs`), `update_count` is included without incrementing, ensuring a 100% consistent `tunnel` schema across all notifications.

---

## Conditional Updates (Optimistic Concurrency Control)

SharedState supports conditional updates to prevent lost updates when multiple clients concurrently mutate the same resource.

### Execution Flow

1. **Option Configuration**:
   A client issues a conditional update by passing `options.conditional = true` to `update_items(changes, { conditional: true })`:
   ```javascript
   coll.update_items({ insert: [{ id: "counter", state: 10 }] }, { conditional: true });
   ```
2. **Payload Generation**:
   The client attaches `last_version: ProxyCollection.version` to the payload `data`. If multiple edits are batched during a microtask frame and any edit requests `conditional: true`, the entire batch is sent as a conditional update.
3. **Server Validation**:
   When the server receives a conditional update, it compares `last_version` against the current per-resource version:
   - **Match (`last_version == server_version`)**: Server applies changes, increments version (`version++`), broadcasts `NOTIFY` with new `version` and `tunnel`, and returns `REPLY` `{ ok: true, version: new_version }`.
   - **Mismatch (`last_version != server_version`)**: Server **rejects the update without mutating state**. Returns `REPLY` `{ ok: false, data: { error: "VERSION_MISMATCH", current_version: server_version } }`. No `NOTIFY` is broadcast.

---

## Client-Side Speculative Local Updates

Speculative local updates allow applications to provide **0ms instant UI feedback** by immediately overlaying local edits before server acknowledgments arrive.

### Architecture: Overlay Facade Pattern

Speculative execution wraps the server-authoritative `ProxyCollection` with a thin speculative facade (`SpeculativeProxyCollection`), opt-in via `local_update: true`, `immediate_update: true`, or `speculative: true`:

```
+-------------------------------------------------------------------------+
|                  SpeculativeProxyCollection (Facade)                    |
| - Maintains local speculative overlay: Map<id, { item, update_count }>  |
| - Intercepts queries: returns overlay item if present, else Proxy       |
| - Emits 0ms change events to Facade callback observers                  |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                      ProxyCollection (Base Layer)                       |
| - Strictly server-authoritative Map<id, item>                           |
| - Manages network dispatching & microtask batching (UpdateBuilder)      |
+-------------------------------------------------------------------------+
```

### The $1 + N$ Eviction Engine

Eviction and reconciliation logic is governed by 1 global counter on the facade and $N$ per-item overlay counters:

1. **1 Global Facade Counter (`facade._last_acked_update_count`)**:
   - Updated **only** when incoming server notifications carry `tunnel.client_id == client.id`.
2. **$N$ Per-Item Overlay Counters (`item.update_count`)**:
   - Stamped on each item in `_overlay` when its speculative edit is dispatched:
     $$\text{item.update\_count} = \text{client.\_last\_requested\_update\_count} + 1$$
3. **Eviction Rule**:
   An overlay item is **evicted (flushed to server state)** if:
   $$\Big(\text{item.update\_count} \le \text{facade.\_last\_acked\_update\_count}\Big) \quad \text{OR} \quad \text{item.is\_expired()}$$

### Reconciliation Flow

1. **Local Write (`update_items`)**:
   - Facade stamps inserted/removed items in `_overlay` with `item.update_count = client._last_requested_update_count + 1`.
   - Invokes Facade callbacks immediately for **0ms UI latency**.
   - Delegates network batching directly to `this._proxyCollection.update_items(changes, options)`. `ProxyCollection` is **not mutated** on write.
2. **Server Notification (`_ssclient_update`)**:
   - **Own ACK (`tunnel.client_id == client.id`)**:
     - Updates `_last_acked_update_count = tunnel.update_count`.
     - Evicts overlay items where `item.update_count <= _last_acked_update_count`.
   - **Remote Edit (`tunnel.client_id != client.id`)**:
     - Updates underlying `ProxyCollection` server state.
     - The facade retains local pending speculative overlays until the local client's own pending update sequence ACKs arrive.
   - **Snapshot Reset (`reset: true`)**:
     - Flushes all speculative overlays (`_overlay.clear()`) and adopts the clean server snapshot.
   - **Callback Suppression**:
     - Facade computes the effective visible state diff before vs. after. If the visible state actually changed, Facade callbacks are invoked. If the server ACK matches what was already speculatively displayed, Facade callbacks are **suppressed** to prevent redundant UI re-renders.
