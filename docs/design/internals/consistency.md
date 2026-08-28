# Consistency


> The SharedState framework provides eventual consistency, with optimistic consistency for zero-latency UI updates. 


---

## Goals 
The SharedState framework is designed with the following main goals:

1. **Eventual Consistency**: 
- The server is the single authoritative source of truth for state.
- Clients may view different versions of the state, at any given time, but will eventually converge on the latest version once update operations cease.

2. **Zero Visible Update Latency**: Updates are applied locally and optimistically, with UI immediately reflecting the change. 

---

## State Update Protocol

- **Client**: `REQUEST UPDATES`:
    - may dispatch updates to the server, without blocking on the completion of earlier updates (*streaming*). 
- **Server**: `PROCESS UPDATES`:
    - processes a stream of interleaved updates originating from different clients.
    - may either accept the update *(ok: true)* or reject it (`ok: false`).
    - sends reply to the client that sent the update request, with the resulting status (`ok: true | false`).
    - sends notify to all subscribed clients, with the new state.
- **Client**: `RECEIVE UPDATES`:
   - receives reply and notify messages, in that order.

---

## Assumptions

The SharedState framework makes the following assumptions: 

- **Sequential Update Processing**: The server processes update requests sequentially, in the order they are received.
- **Ordered Network Transfer**: Message order is preserved over the commounication channel.
- **Bounded Network Latency**: An upper time limit can be assumed for network latency.
- **Bounded Processing Delay**: An upper time limit can be assumed for update processing on the server.
- **Failure Context**: Failures may occur at any time.
- **Failure Event**: Failures include server failure and communication failures.
- **Failure Detection**: Failures may be detected by client, eventually, recongnized either as **connection loss** or as **message loss**.
- **Message loss**: Failures may occur either before processing (`loss of update request`), or after (`loss of reply or notify`).


::: tip Note
The server may **reject** an `UPDATE REQUEST` as part of normal operation (see [State Update Protocol](#state-update-protocol)). This is **not** considered a **failure event**.
:::


---


## Operational Scenarios

Given [State Update Protocol](#state-update-protocol) and [Theoretical Assumptions](#theoretical-assumptions), 5 operational scenenarios need to be considered:


| Scenario | REQUEST | SERVER | REPLY | Client |
| :---  | :--- | :---   | :--- | :--- |
| **A** |  OK  | Accept | OK  | REPLY and NOTIFY received |
| **B** |  OK  | Reject | OK   | REPLY received |
| **C** |  OK  | Accept | LOST | REPLY and NOTIFY not received |
| **D** |  OK  | Reject | LOST | REPLY not received |
| **E** | LOST | N/A      | N/A  | REPLY and NOTIFY not received |

::: tip Note
Scenario (**A, B**) represent normal operation. Scenario (**C, D, E**) represent failure.
:::



## Approach

There is a conflict between the two goals of the SharedState framework: **Eventual Consistency** (authoritative server truth) and **Zero Visible Latency** (instant local feedback). Optimistic local updates provide zero-latency UI rendering, but may lead to inconsistency when updates are rejected by the server, or lost on the network.

To address both goals SharedState adopts a three-part approach:

### 1. Optimistic Overlay
Speculative local edits are not applied to the client view of server state (`ProxyCollection`), but instead layered on top, as an
**optimistic overlay** (`SpeculativeProxyCollection`). Queries then target the overlay first, but will fall back on the underlying `ProxyCollection` if no speculative state has been defined for the queried item. This ensures zero-latency Query latency, combined with easy rollback of local edit when needed.

### 2. Detecting Integrity Threats
The client monitors outgoing update requests and incoming replies/notifications. Three distinct integrity failure conditions are detected:

- **Missing Notification**: Gap in the sequence of notifitions.
- **Missing Reply**: Gap in the sequence of replies.
- **Timeout Reply**: Reply not received in time.

### 3. Resolving Integrity Threats
Upon detecting any integrity threat, the client concludes that its states notifiction stream, or update request stream, is compromised. It resolves the threat by triggering an **immediate self-healing reconnection** (`reconnect(true)`). This re-establishes the WebSocket connection and resets subscriptions, triggering a fresh initialization of client state.


---

## Mechanism

SharedState realizes this approach through a suite of state counters and associated logical checks which evaluate the integrity of the client state. 

### Server Counters

The server maintains one counter for each [ItemCollection].

- **`version`**: The server maintains a version counter which is incremented on every accepted server mutation. This counter is included in replies and notifications sent to clients.

### Client Counters

The client maintains three counters, for each `ProxyCollection`.

- **`last_version`**: The counter tracks the latest version counter received in a notification from the server.
- **`last_update_request_count`**: The counter tracks the update requests dispatched by the client. The counter is incremented for each new update request, and its value is included in the update request. Upon receipt, the server echoes the counter back to the client by including it in the corresponding reply and notification.
- **`last_acked_update_count`**: The counter tracks the latest update request counter received from the server, as part of a reply or notification.

### Failure Conditions

- **Missing Notification**: Gap in the sequence of notifitions.

```js
if (notification.version > last_version + 1) {
   handle_failure();
}
```

- **Missing Reply**: Gap in the sequence of replies.

```js
if (reply.update_count > last_acked_update_count + 1) {
   handle_failure();
}
```

- **Timeout Reply**: Reply not received in time.

```js
if (Date.now() - oldest_pending_timestamp) > ttlMs) {
   handle_failure();
}
```


## Overlay

### Overlay Write Rule

An item is added to the overlay when it is updated locally, replacing any previous item with the same id. 

### Overlay Eviction Rule
An optimistic overlay entry is **evicted (rolled back)** when its update count is acknowledged by the server:

```js
for (item in overlay_items) {
   if (item.update_count <= last_acked_update_count) {
      evict_item(item.id);
   }
}
```



---

## The Rest


### Protocol Engine Execution Rules

#### 1. ACK Handling (`_on_ack(update_count, ok, path)`)

Maintains a sliding-window `pending_updates` Map (`update_count -> { timestamp, path, changes }`) for all outgoing update requests.

Executed on `REPLY` messages (and idempotently on `NOTIFY` broadcasts):

1. **Un-ACKed Gap Check**:
   If `update_count > _last_acked_update_count + 1` while earlier updates remain pending in `pending_updates`:
   An un-ACKed gap is detected -> Trigger `reconnect(true)` (if CONNECTED).
2. **Pending Update Removal**: Remove `update_count` from `pending_updates`.
3. **High-Water Mark Advance**: Update `_last_acked_update_count = Math.max(_last_acked_update_count, update_count)`.
4. **Overlay Eviction & Reversion**: Evict overlay entries where `entry.update_count <= _last_acked_update_count`. If `ok == false`, the speculative entry is cleared and UI state immediately reverts to server truth.
5. **Timeout Re-evaluation**: Re-evaluate the oldest remaining timestamp in `pending_updates`.

#### 2. NOTIFY Handling (`_on_notify(msg)`)

Executed when a server `NOTIFY` broadcast arrives:

1. **Resource Version Evaluation**:
   - `incoming_version < expected_version`: **Stale/Duplicate** -> Ignore.
   - `incoming_version > expected_version`: **Version Gap Discontinuity** -> Trigger `reconnect(true)` (if CONNECTED).
   - `incoming_version == expected_version`: **Valid Update** -> Proceed to apply.
2. **Idempotent ACK Fallback**: Invoke `_on_ack(msg.tunnel.update_count, ok: true)` to ensure `pending_updates` is cleaned up even if a `REPLY` packet was dropped.
3. **State Application**: Apply server changes to base collection. Evict overlay entries where `entry.update_count <= _last_acked_update_count`.

#### 3. Timeout Check & Self-Healing (`_check_pending_timeouts()`)

If a network packet is silently dropped (Scenario C, D, or E), `pending_updates` preserves the oldest un-ACKed update timestamp:

1. Retrieve the entry in `pending_updates` with the lowest `timestamp`.
2. If `Date.now() - lowestTimestamp > ttlMs`:
   - If `connection.state === ConnectionState.CONNECTED`:
     Unconfirmed Update Timeout -> Trigger `reconnect(true)`.
   - If `connection.state !== ConnectionState.CONNECTED`:
     Skip reconnect call (client is already in disconnected/reconnecting state).

Upon `reconnect(true)`, the WebSocket tears down with 0ms delay and reconnects. On reconnect, `_on_connect()` dispatches `PUT /subs` with `reset: true`, fetching fresh authoritative snapshots for all resources.

---

## Protocol Pseudocode Overview

```javascript
// =================================================================
// 1. OUTGOING UPDATE REQUEST
// =================================================================
function on_update_request(path, changes):
    update_count = ++client._update_count
    pending_updates.set(update_count, { timestamp: Date.now(), path, changes })
    overlay.set(item_id, { item: changes, update_count, timestamp: Date.now() })
    send_websocket_request("PUT", path, changes, tunnel: { client_id, request_count, update_count })

// =================================================================
// 2. REPLY HANDLING
// =================================================================
function on_websocket_reply(msg):
    if msg.tunnel.update_count > 0:
        on_ack(msg.tunnel.update_count, ok: msg.ok, path: msg.path)

// =================================================================
// 3. NOTIFY HANDLING
// =================================================================
function on_websocket_notify(msg):
    incoming_version = msg.data.version
    expected_version = collection.version + 1

    if incoming_version < expected_version:
        return // Stale/duplicate notification

    if incoming_version > expected_version:
        trigger_self_healing_reconnect("VERSION_GAP")
        return

    // Valid in-sequence notification
    if msg.tunnel.update_count > 0:
        on_ack(msg.tunnel.update_count, ok: true, path: msg.path) // Idempotent fallback

    collection.version = incoming_version
    collection.apply_server_changes(msg.data)
    collection.evict_overlay(upto: client._last_acked_update_count)

// =================================================================
// 4. ACK HANDLING & GAP CHECK
// =================================================================
function on_ack(update_count, ok, path):
    if update_count > client._last_acked_update_count + 1:
        if has_unacked_earlier_updates(before: update_count):
            trigger_self_healing_reconnect("UNACKED_UPDATE_GAP")
            return

    pending_updates.delete(update_count)
    client._last_acked_update_count = max(client._last_acked_update_count, update_count)

    collection = get_collection(path)
    collection.evict_overlay(upto: client._last_acked_update_count)
    if not ok:
        collection.revert_speculative_state()

    check_pending_timeouts()

// =================================================================
// 5. TIMEOUT CHECK
// =================================================================
function check_pending_timeouts():
    if pending_updates.is_empty():
        return

    oldest_entry = pending_updates.get_oldest_by_timestamp()
    if (Date.now() - oldest_entry.timestamp) > ttlMs:
        if websocket.state == CONNECTED:
            trigger_self_healing_reconnect("UNACKED_UPDATE_TIMEOUT")

// =================================================================
// 6. SELF-HEALING RECONNECT
// =================================================================
function trigger_self_healing_reconnect(reason):
    websocket.reconnect(immediate = true)
    // On socket reconnect: _on_connect() sends PUT /subs reset: true
    // Server returns fresh full snapshots, cleanly clearing all pending state.
```















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

## Conditional Updates 

(Optimistic Concurrency Control)

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

## Speculative Updates



**0ms immediate UI feedback**, SharedState provides `SpeculativeProxyCollection`, an overlay facade that wraps a base `ProxyCollection`:
- **Default Configuration**: Enabled by default (`local_update: true`) in `SharedStateClient`. Can be toggled per collection via `client.acquire_collection(path, { local_update: true })` or `client.load()`.
- **Overlay Interception**: Local writes (`update_items`) immediately update a local overlay map, invoking registered callback handlers instantly without waiting for network latency.
- **$1 + N$ Sequence Eviction**: Overlay entries are stamped with `item.update_count`. When server notifications arrive carrying `tunnel.client_id == my_id`, overlay entries where `item.update_count <= facade._last_acked_update_count` are evicted, smoothly handing control over to the confirmed server state without UI flicker.


Speculative local updates allow applications to provide **0ms instant UI feedback** by immediately overlaying local edits before server acknowledgments arrive.

### Architecture: Overlay Facade Pattern

Speculative execution wraps the server-authoritative `ProxyCollection` with a thin speculative facade (`SpeculativeProxyCollection`), active by default via `local_update: true`:

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
