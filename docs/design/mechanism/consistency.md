[Item]: /design/representation/item_collection#item
[Items]: /design/representation/item_collection#item
[ItemCollection]: /design/representation/item_collection#itemcollection
[ItemCollections]: /design/representation/item_collection#itemcollection
[ProxyCollection]: /design/representation/proxy_collection
[ProxyCollections]: /design/representation/proxy_collection

# Consistency


> The SharedState framework delivers Strong Eventual Consistency (SEC) paired with zero delay interactivity, through optimistic local updates.


---
## In a Nutshell

This outlines how the SharedState framework maintains consistency with respect to replicas, sessions, and optimistic client-side updates.


1. State changes are expressed in terms of individual [Items] within [ItemCollections]. Consistency in SharedState can therefore be discussed in terms of a single item.

2. A client maintains a local `replica` for a server item. Updates for this item do **not affect** the `replica` directly. Instead, an update request is sent to the server, where the update is carried out. Only when the update is acknowledged by server notification, is the client `replica` updated. This ensures that the `replica` always reflects the server-side truth.

3. However, updates are also applied optimistically to an isolated state `overlay` on the client. This `overlay` takes **precedence** over the client's `replica`, implying that the effects of the update immediately become visible to the application, **before** being dispatched to the server.

4. Under normal operation, the update will be acknowledged through server notification within fractions of a second, and the effects will immediately be committed to the client's `replica`. At this point, the `overlay` and the `replica` both reflect the **same** state for the item, and the optimistic update may therefore safely be removed from the `overlay`.

5. In the (rare) case of message loss or server failure, optimistic updates to the `overlay` will **not necessarily** be undone quickly by server notification, as is the case under normal operation. Instead, the client may be left in an ambiguous state, where it **cannot with certainty** conclude whether a failure has occurred or not. As a consequence, the optimistic update in the `overlay` will continue to override the `replica` until this ambiguity is resolved, even if the `replica` is subsequently updated by other clients.

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

In order to maintain `replicas` in a state of strong consistency, the client must be protected against unordered message delivery. The SharedState framework achieves this by assigning a version number to each state change.

The server maintains one version counter for each [ItemCollection]:

- **`version`**: The server increments the version counter on every state mutation to the [ItemCollection]. This version counter is then included in notifications sent to clients.

The client maintains a corresponding counter for each [ProxyCollection]:

- **`last_version`**: The client maintains a `last_version` counter for each [ProxyCollection]. This counter tracks the latest version counter received in a notification from the server.


This allows the client to ignore outdated or duplicated notifications, and to treat missing notifications as a failure condition.

```js
if (notification.version > last_version + 1) {
   this.handle_failure();
}
```

---
### Recovery from Consistency Failures

Upon detecting a consistency failure, the client recovers by terminating the connection, and resetting the session with a fresh copy of server state. Moreover, as the SharedState client is designed to mask temporary network disconnects, this session reconnect is achieved without disrupting the application.

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

This implies that session consistency must be discussed in terms of three distinct failure types:
- `loss of connection`
- `loss of request`
- `loss of reply/notification`


::: tip Note
The server may **reject** an update request as part of normal operation (see [State Update Protocol](#state-update-protocol)). This is **not** a failure event. 
:::

---
### Failure Recovery

Upon detecting a failure condition, the client recovers by resetting the session, therby tearing down a possibly compromised socket connection.  

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
- Scenarios (**D_1, D_2**) are indistinguishable for the client, and are therefore treated as a single scenario (**D**).
:::


---
### Detecting Failures

In order to detect consistency failures, the client maintains two counters for each `ProxyCollection`:

- **`last_update_count`**: This counter is incremented for each update request sent by the client, and its value is included in the request message. Upon receipt, the server echoes the value of this counter back to the client, by including it in the corresponding reply and notification messages.
- **`last_acked_update_count`**: This counter tracks the latest update message that has been acknowledged by the server, and is updated on the receipt of every reply message.


This allows for the detection of gaps in the sequence of acknowledged replies, serving as confirmation of message loss. The client must then initiate recovery procedures.


```js
if (reply.update_count > last_acked_update_count + 1) {
    handle_failure();
}
```

---
### Timeout-Based Failure Recovery

Not all failures can be detected through message inspection. For example, if a message is lost (scenarios **C** and **D**), and the client does not dispatch any more update requests after this event, there is no way to detect the loss, except to rely on the assumption of **bounded processing delays** and **bounded network latency** (see [Failure Model Assumptions](#failure-model-assumptions)). By setting a timeout according to this assumption, the client may eventually conclude that the session has failed, and initiate recovery procedures.

```js
if (Date.now() - oldest_pending_timestamp > ttlMs) {
    handle_failure();
}
```






















---
## Part 3: Optimistic Consistency

> The SharedState framework combines consistency with zero delay interactivity, through optimistic local updates.

Zero update delays are achieved by optimistically applying updates locally, before dispatching update requests to the server. 
However, local updates represent a source of inconsistency, particularly in the event that update requests are lost or rejected by the server. The SharedState client addresses this by rolling back the effects of optimistic updates, when needed.

### Optimistic State Overlay

Consistency in the SharedState framework can be discussed in terms of individual [Items] within an [ItemCollection]. The 
client maintains a client-side `replica` for items, represented by a [ProxyCollection]. Moreover, in order to protect the integrity of this `replica`, the client does not alter its state directly, but rather applies item updates to an `overlay`, layered on top of the `replica`. Queries targets the `overlay` first, falling back to the underlying `replica`. This provides zero-latency for state updates, while also ensuring that optimistic changes can be easily undone when needed.

---
### Overlay Update & Query Rules

- **Update**: Item updates replace any previous entries in the overlay for the same `id`, and are tagged with the current `update_count`.

```js
last_update_count++;
for (let item of update_items) {
   overlay.set(item.id, item);
   item.update_count = last_update_count;
}
```

- **Query**: Item queries are resolved against the `overlay` first, immediately returning the optimistic state, if such state exists. If not, the query is resolved from the underlying `replica` (i.e., [ProxyCollection]).

```js
get_item(id) {
   return overlay.get_item(id) || replica.get_item(id);
}
```

---
### Overlay Eviction Rule

When update requests have been acknowledged by the server and committed to the client `replica`, corresponding `items` in the `overlay` are no longer speculative, and may therefore be safely evicted.


```js
for (const [id, item] of overlay.entries()) {
   if (item.update_count <= last_acked_update_count) {
      overlay.delete(id);
   }
}
```

::: tip Note
In both scenario **A** and **B**, the optimistic `item` is evicted immediately upon receipt of the reply message. In scenario **A**, this will not be noticeable, as the reply essentially confirms the correctness of the current state. However, in scenario **B**, the eviction of the `item` from the `overlay` materializes as a state transition, back to the truth of the `replica`. 
:::













## Part 4: Life of an optimistic update

This presents a walkthrough of the protocol, focusing on the different outcomes for a single update in the event of failures.


### Local Update
- A new update request is assigned `update_count = last_update_count + 1`.
- The new item is inserted into the local `overlay`, stamped with `update_count`.
- Queries to the client state immediately return the new item (0 ms latency).

### Scenario A: Normal Operation
- The server accepts the update and returns `REPLY(ok: true)` and `NOTIFY`.
- `last_acked_update_count = item.update_count`.
- The new item is silently evicted from the `overlay`. 

### Scenario B: Server Rejection
- The server rejects the update and returns `REPLY(ok: false)`.
- `last_acked_update_count = item.update_count`.
- The new item is evicted from the `overlay`, resulting in a synthetic state change locally, back to the state of the underlying [ProxyCollection].

### Scenario C: Accepted Update, Response Lost
- The server accepts the update `u1`, but the reply was lost on the network.
- The new item remains in the `overlay`.
- **Alternative Resolutions**:
  - **On Next External Update**: An external client updates the same resource, triggering notifications of state change. If no external update were processed before `u1`, the client will detect a gap in the version sequence `version > last_version + 1` and triggers `reconnect(true)`. If not, the situation is inconclusive.
  - **On Next Self Update**: The client itself dispatches a new update `u2`. The server reply betrays a gap in the sequence of replies (`update_count > last_acked_update_count + 1`), prompting the client to `reconnect(true)`.
  - **On Timeout**: If no further updates occur, `u1` times out after 10 seconds (`ttlMs`), triggering `reconnect(true)`.

### Scenario D: Lost Request / Response
- The update request `u1` was lost before processing, or rejected but with a lost reply.
- The new item remains in the `overlay`.
- **Resolution**:
  - **On Next External Update**: An external client updates the same resource. The situation is inconclusive. 
  - **On Next Local Update**: The client itself dispatches a new update `u2`. The server reply betrays a gap in the sequence of replies (`update_count > last_acked_update_count + 1`), prompting the client to `reconnect(true)`.
  - **On Timeout**: If no further updates occur, `u1` times out after 10 seconds (`ttlMs`), triggering `reconnect(true)`.
