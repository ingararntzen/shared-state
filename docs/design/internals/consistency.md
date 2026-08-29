[Item]: /design/item_collections/item_collection#item
[Items]: /design/item_collections/item_collection#item
[ItemCollection]: /design/item_collections/item_collection#itemcollection
[ItemCollections]: /design/item_collections/item_collection#itemcollection
[ProxyCollection]: /design/item_collections/client_proxies
[ProxyCollections]: /design/item_collections/client_proxies

# Consistency


> The SharedState framework delivers Strong Eventual Consistency (SEC) paired with zero delay interactivity, through optimistic local updates.


---
## In a Nutshell

This outlines how the SharedState framework maintains consistency with respect to replicas, sessions, and optimistic client-side updates.


1. State changes are expressed in terms of individual [Items] within [ItemCollections]. Consistency in SharedState can therefore be discussed in terms of a single item.

2. A client maintains a local `replica` for a server item. Updates for this item do **not affect** the `replica` directly. Instead, an update request is sent to the server, where the update is carried out. Only when the update is acknowledged by server notification, is the client `replica` updated. This ensures that the `replica` always reflects the server-side truth.

3. However, updates are also applied optimistically to an isolated state `overlay` on the client. This `overlay` takes **precedence** over the client's `replica`, implying that the effects of the update immediately become visible to the application, **before** being dispatched to the server.

4. Under normal operation, the update will be acknowledged through server notification within fractions of a second, and the effects will immediately be committed to the client's `replica`. At this point, the `overlay` and the `replica` both reflect the **same** state for the item, and the optimistic update may therefore safely be removed from the `overlay`.

5. In the (rare) event of message loss or server failure, optimistic updates to the `overlay` will **not necessarily** be undone quickly by server notification, as is the case under normal operation. Instead, the client is left in an ambiguous state, where it **cannot with certainty** conclude whether a failure has occurred. Consequently, the optimistic update to the `overlay` will continue to obscure the `replica` until this situation is resolved, even if the `replica` is subsequently updated by other clients.

6. The client recovers from this situation in one of two ways. If the client does not remain inactive, but continues to issue updates to the server, a subsequent, successful update will confirm the failure situation with certainty. Otherwise, the situation is resolved with a timeout (10s). In either case, the session is deemed to have failed, and recovery is achieved by seamlessly disconnecting and initializing a new session.





---
## Part 1: Replica Consistency

> The SharedState framework provides Strong Eventual Consistency (SEC) for client-side **replicas**.

### Strong Eventual Consistency (SEC)

In distributed systems, **Strong Eventual Consistency (SEC)** guarantees that any two replicas that have processed the same set of updates will **immediately** hold **identical state**. Here, **immediate** means that **identical state** is reached right away, without requiring an additional reconciliation phase of conflict resolution and consensus.

In the SharedState framework, SEC is supported on a per-resource basis: 

- The server is the single authoritative source of truth for state.
- The server processes update operations sequentially.
- Operation ordering is preserved through communication to clients.
- Updates are deterministic, as SharedState implements [Passive Replication](/concept/replication).


---
### State Update Protocol

The following defines the replication protocol implemented by the SharedState framework.

- **Client**: `REQUEST UPDATES`:
   - Clients may dispatch update requests to the server without blocking on the completion of earlier updates (*streaming*). 
- **Server**: `PROCESS UPDATES`:
   - The server processes a stream of interleaved updates originating from different clients.
   - The server may either accept the update *(ok: true)* or reject it (`ok: false`).
   - The server sends a reply to the client that sent the update request, with the resulting status (`ok: true | false`).
   - The server sends a notification to all subscribed clients, with the new state.
- **Client**: `RECEIVE UPDATES`:
   - Each client receives a reply and a notification message, in that order.
   - Each client updates its local `replica` with the new state.


---
### Detecting Consistency Threats

In order to maintain the consistency of `replicas`, the client must be protected against unordered message delivery. The SharedState framework achieves this by assigning a version number to each state change.

The server maintains one version counter for each [ItemCollection]:

- **`version`**: The server increments the version counter on every state mutation to the [ItemCollection]. This version counter is then included in notifications sent to clients.

The client maintains a corresponding counter for each [ProxyCollection]:

- **`last_version`**: The client maintains a `last_version` counter for each [ProxyCollection]. This counter tracks the latest version counter received in a notification from the server.


This allows the client to ignore outdated or duplicated notification, and to treat missing notifications as a failure condition.

```js
if (notification.version > last_version + 1) {
   this.handle_failure();
}
```

### Recovery from Consistency Failures

Upon detecting a consistency failure, the client recovers by terminating the connection and initiating a new session. As the SharedState client is designed to mask temporary network disconnects, this can be achieved without disrupting the application.

```js
handle_failure() {
   this.client.reconnect(true);
}
```






















---
## Part 2: Session Consistency

> The SharedState framework maintains the consistency of a client **session** in the event of failures.


---
### Failure Model Assumptions

The failure model is defined by the following assumptions: 

- **Bounded Network Latency**: An upper time bound is assumed for network latency.
- **Bounded Processing Delay**: An upper time bound is assumed for update processing on the server.
- **Failure Events**: Failures include server failures and communication failures.
- **Server Failures**: Server failures are assumed to be *fail-stop* and are detectable by clients as connections are lost.
- **Communication Failures**: Message loss may occur either before server processing, or after.

The implies that session consistency must be discussed in terms of three distinct failure types:
- `loss of connection`
- `loss of request`
- `loss of reply/notification`


::: tip Note
The server may **reject** an update request as part of normal operation (see [State Update Protocol](#state-update-protocol)). This is **not** a failure event. 
:::


### Failure Recovery

Upon detecting a failure condition, the client recovers by terminating the connection and initiating a new session. As the SharedState client is designed to mask temporary network disconnects, this can be achieved without disrupting the application.

```js
handle_failure() {
   this.client.reconnect(true);
}
```


---
### Operational Scenarios

In order to detect failures, the following operational scenarios are condidered:

| Scenario | REQUEST | SERVER | REPLY | Client Observation |
| :---  | :--- | :---   | :--- | :--- |
| **A** |  OK  | ACCEPT | OK  | `REPLY(ok: true)`, `NOTIFY` received |
| **B** |  OK  | REJECT | OK   | `REPLY(ok: false)` received |
| **C** |  OK  | ACCEPT | LOST | `REPLY`, `NOTIFY` **NOT** received |
| **D_1** | LOST | N/A | LOST | `REPLY`, `NOTIFY` **NOT** received |
| **D_2** | OK | REJECTED | LOST | `REPLY`,`NOTIFY` **NOT** received |

::: tip Note
- Scenarios (**A, B**) represent normal operation. Scenarios (**C, D**) represent failure.
- Scenarios (**D_1, D_2**) are indisinguashable for the client, and is therefor treates as a single scenario (**D**).
:::


---
### Detecting Failures

In order to detect consistency failures, the client maintains two counters for each `ProxyCollection`:

- **`last_update_count`**: This counter is incremented for each update request sent by the client, and its value is included in the request message. Upon receipt, the server echoes the value of this counter back to the client, by including it in the corresponding reply and notification messages.
- **`last_acked_update_count`**: This counter tracks the letest update message that has been acknowledged by the server, and is updated on the receipt of every reply message.


This allows for the detection of gaps in the sequence of acknowledged replies, serving as confirmation of message loss. The client must then initiate recovery procedures.


```js
if (reply.update_count > last_acked_update_count + 1) {
    handle_failure();
}
```

### Timeout-Based Failure Recovery

Not all failures can be detected through message inspection. For example, if a message is lost (scenarios **C** and **D**), and the client does not dispatch any more update requests after this event, there is no way to detect the loss, except to rely on the assumption of **bounded processing delays** and **bounded network latency** (see [Failure Model Assumptions](#failure-model-assumptions)). By setting a timeout according to this assumption, the client may eventually conclude that the session has failed, and initiate recovery procedures.

```js
if (Date.now() - oldest_pending_timestamp > ttlMs) {
    handle_failure();
}
```






















---
## Part 3: Optimistic Consistency

---
### Goal

**Zero Visible Update Latency**: Updates are applied locally and optimistically, with UI immediately reflecting the change. 


---
### Approach

#### Optimistic Overlay

Speculative local edits are not applied directly to the client's view of server state (`ProxyCollection`), but are instead layered on top as an **optimistic overlay** (`SpeculativeProxyCollection`). Queries target the overlay first, falling back to the underlying `ProxyCollection` if no speculative state exists for the queried item. This ensures zero-latency UI updates combined with effortless rollback of local edits when needed.

#### Reply Eviction
- on normal operation, evict speculative items from the overlay on reply.


---
### Mechanism

SharedState realizes this approach through a suite of state counters and associated logical checks that evaluate the integrity of the client state. 



The optimistic overlay (`SpeculativeProxyCollection`) supports local updates without tampering with the client's view of server state (`ProxyCollection`):

#### Read & Write Rules

- **Write**: When an item is updated locally, it is inserted into the overlay and tagged with the appropriate update count: `update_count = last_update_count + 1`. The item replaces any pre-existing entry with the same item `id`.
- **Read**: Item lookups query the overlay first. If an item exists in the overlay, it is returned immediately. Otherwise, no speculative state exists for the item and the lookup falls back to the server-authoritative `ProxyCollection`.

#### Eviction Rule

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









## Part 5: Life of a Speculative Item

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
