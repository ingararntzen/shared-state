[Items]: /design/representation/item_collection#item
[ItemCollections]: /design/representation/item_collection#itemcollection
[ItemProvider]: /design/representation/item_provider

# Consistency Model

> The SharedState framework delivers **Strong Eventual Consistency (SEC)** paired with **zero-delay interactivity** through optimistic local updates.


Local updates are speculative in nature and thereby a temporary source of inconsistency. SharedState combines zero-delay local updates with strong server-authoritative consistency across three distinct dimensions:

1. **Replica Consistency**: Strong Eventual Consistency (SEC) for client-side replicas.
2. **Session Consistency**: Automated failure detection and recovery for client sessions.
3. **Optimistic Consistency**: Optimistic local updates with automated rollback to server state if rejected.

---
## 1. Replica Consistency

The server is the single authoritative source of truth for all shared state. 

SharedState achieves **Strong Eventual Consistency (SEC)** for client-side replicas ([ItemProvider]):
- The server processes mutations sequentially per resource and tags each committed edit with a version counter.
- Operation ordering is preserved over the network stream to clients.
- Updates are deterministic, as SharedState implements [Passive Replication](/concept/replication).

Any two clients that have received updates up to version `v` hold identical state.


---
## 2. Session Consistency

Session consistency concerns the integrity of the client view in the event of server failure (fail-stop) or network communication breakdown. Failures are constrained to three categories: 

- **loss of connection**
- **loss of request**
- **loss of reply/notification**

Consistency threats are detected by clients:
- **connection failure**
- **gap in notification sequence**
- **gap in request/reply sequence**
- **timeout on unacknowledged updates**

Consistency threats are resolved by disconnecting and reconnecting to the server, thereby initializing a fresh client session. This happens automatically, without disrupting the application.


---
## 3. Optimistic Consistency

To mask network latency in the user experience, update requests are applied optimistically at the client-side, before being dispatched to the server. Automated support for rollback of rejected update requests is achieved by keeping optimistic state changes separate from the server-authoritative state until acknowledged by the server:


- **State Overlay**: Local updates do **not** alter the underlying server replica ([ItemProvider]) directly, but are instead applied to a separate `overlay` construct.
- **Query Precedence**: Local lookups query the `overlay` first, then the server-authoritative [ItemProvider].
- **Rollback**: Optimistic updates are removed from the `overlay` when updates are acknowledged by the server. If the update request is rejected, this triggers a rollback to server authoritative state.
- **Failures**: In failure scenarios, optimistic updates will continue to take precedence over server truth, until the failure is resolved, by a 10s timeout in the worst case.


---
## 4. Consistency Specification

For a deeper discussion of failure model, operational scenarios, protocol walkthroughs, and implementation details, see [Consistency Specification](/design/mechanism/consistency).
