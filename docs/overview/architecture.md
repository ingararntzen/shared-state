# SharedState Architecture

The **SharedState Architecture** combines a **Primary-Backup replication model** with a **"Dumb Server, Smart Client"** design. It enables real-time collaborative applications to maintain low-latency local reads, clean backend storage, and optimistic concurrency control across network resources.

In industry literature, this pattern aligns with **Server-Authoritative State Replication** and **Optimistic Concurrency Control (OCC) with Client-Side Rebasing**.

For the developer mental model, see [The SharedState Paradigm](/overview/paradigm.md).

---

## 1. Primary-Backup Model with Client Replicas

SharedState adopts a Primary-Backup topology where the central server acts as the **Primary** and clients host local **Replicas**:

```
[ Client A Replica ] (Reads instantly local)
        │
        ├── Updates (Network Delay) ──► [ Primary Server ] (Single Source of Truth)
        │                                      │
[ Client B Replica ] ◄── Notifications ─────────┘
```

* **Queries**: Resolve **immediately (0ms latency)** against the client's local state replica in memory.
* **Updates**: Dispatched across the network to the Primary server.
* **Replication**: Client replicas are *only* mutated when official state change notifications are received from the Primary server (or via explicit local rollback/rebase).

---

## 2. The "Dumb Server" Approach & Higher-Level Abstractions

A central architectural decision in SharedState is keeping the server **generic and domain-agnostic**.

The server does not know what application entities represent. It only manages collections of `(key, item)` pairs. This "dumb server" approach moves data structure logic to **"smart" client libraries**, enabling higher-level abstractions to be built on top of the simple key-value collection:

| Abstraction | Client-Side Representation over `(key, item)` |
| :--- | :--- |
| **List** | Sequentially indexed and ordered elements (using fractional keys or order-statistic trees). |
| **Tree** | Hierarchical parent-child relationships (storing node references and parent keys). |
| **Track** | Non-overlapping timeline intervals (for media playback, scheduling, or event tracks). |

Because the server treats items as generic payloads, introducing a new higher-level data structure requires **zero changes to backend server code**.

---

## 3. Resource & Item Management

* The server hosts named, independent **Resources**.
* Each resource is represented as an **Item Collection** of `(id, state)` items.
* Items within a collection can be added, removed, or replaced.
* Multiple operations across items in a collection can be packaged into a single **atomic batch update**.

---

## 4. Consistency Model & Total Ordering

SharedState provides **Server-Authoritative Total Ordering** to ensure clean data integrity:

* **Global Server Sequence**: The Primary server serializes all incoming update requests sequentially.
* **Resource Versioning**: The server maintains a monotonically increasing version number (or revision clock) per resource.
* **Single-Server Batch Atomicity**: Update batch operations (`{ remove, insert, reset }`) on a single server guarantee that intermediate states are never visible to other subscribed clients. All changes in a batch are broadcast in a single notification payload.
* **Transaction Scope**: Currently, SharedState provides single-server batch transaction atomicity. It does not implement multi-server distributed transactions, keeping the server implementation lightweight, fast, and scalable.

---

## 5. Version-Annotated Updates & Concurrency Control

To prevent race conditions when multiple clients modify the same resource simultaneously, SharedState uses **Optimistic Concurrency Control (OCC)**:

1. **Annotated Request**: When a client dispatches an update request, it attaches the target resource version number read from its current local state replica.
2. **Server Verification**: Upon receiving the request, the server compares the request version against its current live version:
   * **Version Matches**: The server applies the changes, increments the resource version, commits the update, and broadcasts notifications to all subscribers.
   * **Version Outdated**: The server rejects the request because another client's update was committed in the interim.
3. **Client Rebase / Retry**: If denied, the client updates its local state with the newest server snapshot and can re-apply or rebase its changes.

---

## 6. Strong Eventual Consistency (Server as Single Source of Truth)

Because the Primary server is the single source of truth and enforces total sequence ordering:

* Replicas converge deterministically to the exact server state (**Strong Eventual Consistency**).
* Unlike multi-master P2P systems, there is no need for server tombstones, complex distributed vector clocks, or lock-free CRDT merge graphs at the database layer.

---

## 7. Default vs. Speculative Local Updates

### Default Behavior (Confirmed Updates)
By default, client-side edits do not mutate the confirmed local state immediately. Instead, the client calculates a state diff, dispatches it to the server, and waits for official server notification before updating the UI proxy.

### Optional Speculative Local Updates (Future Extension)
The architecture supports **speculative local state updates**:
* A **speculative shadow collection** overlays pending edits over the confirmed server state for zero-latency local UI feedback.
* If the server accepts the update, the speculative edit is merged into the confirmed state.
* If the server rejects the update (due to a version mismatch), the speculative layer is rolled back cleanly without corrupting the confirmed server replica.
