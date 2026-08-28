[ItemCollection]: /design/item_collections/item_collection#itemcollection
[ItemCollections]: /design/item_collections/item_collection#itemcollection

# Consistency


> The SharedState framework delivers **Strong Eventual Consistency (SEC)** paired with **optimistic 0ms UI responsiveness**.


Local speculative edits immediately update an isolated client-side **overlay**, taking local UI precedence. Under normal operation, server acknowledgments arrive within milliseconds, smoothly evicting the overlay and handing visual state over to confirmed server state. If an update is lost due to network or server failure, local edits temporarily obscure external changes to preserve editing fluidity until resolved—either immediately by a subsequent local update (sequence gap resync) or after a 10-second timeout (self-healing resync).

::: tip What Strong Eventual Consistency (SEC) Means in SharedState
In distributed systems, **Strong Eventual Consistency (SEC)** guarantees that any two replicas that have processed the same set of updates will immediately hold **identical state**, without requiring complex client-side conflict resolution, vector clocks, or consensus rounds.

SharedState achieves SEC for its base server state (`ProxyCollection`) through **total ordering on the server**: the server processes mutations sequentially per resource and tags each committed edit with a monotonic `version` counter ($1, 2, 3 \dots$). Any two clients at version $V$ hold byte-for-byte identical state. Local speculative overlays (`SpeculativeProxyCollection`) provide instant 0ms UI updates on top of this foundation, temporarily masking server state for speculatively edited items until confirmed or evicted.
:::


---

## Goals 
The SharedState framework is designed with the following main goals:

1. **Strong Eventual Consistency (SEC)**: 
- The server is the single authoritative source of truth for state.
- Because the server assigns a deterministic, monotonic `version` sequence to every committed mutation, any two clients that have received updates up to version $V$ are guaranteed to hold byte-for-byte identical state immediately.

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
- **Ordered Network Transfer**: Message order is preserved over the communication channel.
- **Bounded Network Latency**: An upper time limit can be assumed for network latency.
- **Bounded Processing Delay**: An upper time limit can be assumed for update processing on the server.
- **Failure Context**: Failures may occur at any time.
- **Failure Event**: Failures include server failure and communication failures.
- **Failure Detection**: Failures may be detected by client, eventually, recognized either as **connection loss** or as **message loss**.
- **Message loss**: Failures may occur either before processing (`loss of update request`), or after (`loss of reply or notify`).


::: tip Note
The server may **reject** an `UPDATE REQUEST` as part of normal operation (see [State Update Protocol](#state-update-protocol)). This is **not** considered a **failure event**.
:::


---


## Operational Scenarios

Given [State Update Protocol](#state-update-protocol) and [Assumptions](#assumptions), 4 operational scenarios need to be considered:


| Scenario | REQUEST | SERVER | REPLY | Client Observation |
| :---  | :--- | :---   | :--- | :--- |
| **A** |  OK  | Accept | OK  | `REPLY(ok: true)` and `NOTIFY` received |
| **B** |  OK  | Reject | OK   | `REPLY(ok: false)` received |
| **C** |  OK  | Accept | LOST | `REPLY` and `NOTIFY` not received (Server mutated state) |
| **D** | LOST / Rejected | N/A | LOST | `REPLY` and `NOTIFY` not received (Server state unchanged) |

::: tip Note
Scenarios (**A, B**) represent normal operation. Scenarios (**C, D**) represent failure.
:::


---


## Approach

There is a conflict between the two goals of the SharedState framework: **Strong Eventual Consistency (SEC)** (authoritative server truth) and **Zero Visible Latency** (instant local feedback). Optimistic local updates provide zero-latency UI rendering, but may lead to inconsistency when updates are rejected by the server or lost on the network.

To address both goals, SharedState adopts a three-part approach:

### 1. Optimistic Overlay
Speculative local edits are not applied directly to the client's view of server state (`ProxyCollection`), but are instead layered on top as an **optimistic overlay** (`SpeculativeProxyCollection`). Queries target the overlay first, falling back to the underlying `ProxyCollection` if no speculative state exists for the queried item. This ensures zero-latency UI updates combined with effortless rollback of local edits when needed.

### 2. Detecting Integrity Threats
The client monitors outgoing update requests and incoming replies/notifications. Three distinct integrity failure conditions are detected:

- **Missing Notification**: Gap in the sequence of notifications.
- **Missing Reply**: Gap in the sequence of replies.
- **Timeout Reply**: Reply not received within the expected time limit.

### 3. Resolving Integrity Threats
Upon detecting any integrity threat, the client concludes that its notification stream or update request stream is compromised. It resolves the threat by triggering an **immediate self-healing reconnection** (`reconnect(true)`). This re-establishes the WebSocket connection and resets subscriptions, triggering a fresh initialization of client state.


---

## Mechanism

SharedState realizes this approach through a suite of state counters and associated logical checks that evaluate the integrity of the client state. 

### Server Counters

The server maintains one counter for each `ItemCollection`:

- **`version`**: The server maintains a version counter which is incremented on every accepted server mutation. This counter is included in replies and notifications sent to clients.

### Client Counters

The client maintains three counters for each `ProxyCollection`:

- **`last_version`**: Tracks the latest version counter received in a notification from the server.
- **`last_update_count`**: Tracks update requests dispatched by the client. This counter is incremented for each new update request, and its value is included in the request metadata (`tunnel`). Upon receipt, the server echoes the counter back to the client in the corresponding reply and notification.
- **`last_acked_update_count`**: Tracks the latest update request counter confirmed by the server as part of a reply or notification.

### Failure Conditions

- **Missing Notification**: Gap in the sequence of notifications.

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

- **Timeout Reply**: Reply not received within the expected time limit.

```js
if (Date.now() - oldest_pending_timestamp > ttlMs) {
    handle_failure();
}
```


---

## Overlay

The optimistic overlay (`SpeculativeProxyCollection`) supports local updates without tampering with the client's view of server state (`ProxyCollection`):

### Read & Write Rules

- **Write**: When an item is updated locally, it is inserted into the overlay and tagged with the appropriate update count: `update_count = last_update_count + 1`. The item replaces any pre-existing entry with the same item `id`.
- **Read**: Item lookups query the overlay first. If an item exists in the overlay, it is returned immediately. Otherwise, no speculative state exists for the item and the lookup falls back to the server-authoritative `ProxyCollection`.

### Eviction Rule

An optimistic overlay entry is **evicted (reconciled with server truth)** as soon as its update count has been acknowledged by the server (`update_count <= last_acked_update_count`):

```js
for (const [id, item] of overlay.entries()) {
    if (item.update_count <= last_acked_update_count) {
        evict_item(id);
    }
}
```

- **Accepted Update (`ok: true`)**: The item in the overlay is now backed by the underlying `ProxyCollection`, and may therefore safely be removed from the overlay.
- **Rejected Update (`ok: false`)**: The overlay entry is evicted, immediately reverting the item to its un-edited server state.


---

## Life of a Speculative Item

When a client mutates an item locally, the item enters a speculative lifecycle until it is eventually reconciled (evicted) back to server truth:

### 1. Speculative Creation
- A new update request is assigned `update_count = last_update_count + 1`.
- The item is inserted into the local optimistic overlay (`_overlay`), stamped with `update_count`.
- Queries and UI callbacks immediately reflect the speculative item (0ms latency), masking any underlying base state for that item.

### 2. Reconciliation Paths

A speculative item transitions back to confirmed server state via one of 4 scenario paths:

#### Path A: Normal Success (Scenario A)
- Server accepts the update and returns `REPLY(ok: true)` and/or `NOTIFY`.
- `last_acked_update_count` advances to $\ge \text{item.update\_count}$.
- The overlay item is **evicted**, smoothly transferring visual rendering to the updated `ProxyCollection` base state without UI flicker.

#### Path B: Server Rejection (Scenario B)
- Server rejects the update and returns `REPLY(ok: false)`.
- `last_acked_update_count` advances to $\ge \text{item.update\_count}$.
- The overlay item is **evicted**, immediately reverting the item back to its un-edited server-authoritative state.

#### Path C: Accepted Update, Response Lost (Scenario C)
- Server accepted the update, but the response was lost on the network.
- The item remains speculative in the local overlay.
- **Resolution**:
  - **On Next Remote Update**: A remote client updates the resource, triggering `NOTIFY(version)`. The client observes `version > last_version + 1` (Missing Notification) and triggers an immediate self-healing reconnection (`reconnect(true)`).
  - **On Next Local Update**: The client dispatches a new update $N + 1$. The server's reply betrays that update $N$ was un-ACKed (`N + 1 > last_acked + 1`), triggering `reconnect(true)`.
  - **On Timeout**: If no further updates occur, the unconfirmed update times out after 10 seconds (`ttlMs`), triggering `reconnect(true)`.

#### Path D: Lost Request / Response (Scenario D)
- Request was lost on the network before reaching the server (or rejected without reply).
- The speculative item remains in the overlay, masking server state locally for that item while allowing unmodified items to update normally.
- **Resolution**:
  - **On Next Local Update**: When the client dispatches update $N + 1$, the server's reply carries `update_count = N + 1`. The client detects `N + 1 > last_acked + 1` (Missing Reply) and triggers an immediate self-healing reconnection (`reconnect(true)`).
  - **On Timeout**: If the user stops editing, update $N$ sits unconfirmed past 10 seconds (`ttlMs`). The client detects a Timeout Reply and triggers `reconnect(true)`, tearing down the socket, purging the speculative overlay, and restoring clean server state.
