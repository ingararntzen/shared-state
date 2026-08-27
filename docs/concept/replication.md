[Item]: /design/item_collections/item_collection#item
[Items]: /design/item_collections/item_collection#item
[ItemCollection]: /design/item_collections/item_collection#itemcollection
[ItemCollections]: /design/item_collections/item_collection#itemcollection

# Replication Strategy

> - The SharedState framework adopts a **passive**, **delta-based** replication strategy.
> - **State changes** are expressed as membership changes (`remove`, `insert`, `reset`) over **collections of immutable items**.

---

## Distributing State Changes

Online state replication depends on communicating **state changes** across the network. In the SharedState framework this occurs in three scenarios:

1. **Initialization**: The server dispatches **state changes** to the client as part of state initialization. This occurs whenever a client subscribes to a new resource or changes its subscription.
2. **Update**: The client dispatches desired **state changes** to the server as part of an update request.
3. **Notification**: The server broadcasts **state changes** to all subscribing clients when a resource is updated.

---

## Passive vs. Active Replication

In distributed systems literature, a core distinction exists between **passive** and **active** replication:

- **Passive Replication**: The client transmits the desired **state** (or **state delta**) to the primary server, which then forwards a copy of this state to all replicas.
- **Active Replication**: The client transmits a **deterministic command** to the primary server, which then forwards the same command to all replicas. The **new state** is computed independently on each replica by executing the command against local state.

SharedState is an instance of **passive replication**. This aligns directly with the framework's core design goal of providing a domain-agnostic, generic mechanism for state sharing (see [Dumb Server Approach](/concept/paradigm#5-dumb-server-approach)). Importantly, this passive replication strategy allows application-specific business logic and commands to be implemented on top of the framework, without requiring modifications to framework.

---

## Full-state vs. Delta-based Replication

Replication systems can further be classified as **full-state** or **delta-based**:

- **Full-State Replication**: The client transmits the new **state** to the primary, which forwards copies of the state to all replicas.
- **Delta-Based Replication**: The client transmits only a **state delta** (the difference) to the primary, which then forwards the same **state delta** to all replicas. The **new state** is then constructed locally by applying the **state delta** to the local state.

SharedState uses **delta-based replication** to minimize network bandwidth consumption. This is particularly important when large resources undergo small, frequent modifications.

---

## Unit of Replication

> SharedState uses **collections** of **immutable items** as the unit of replication.

This approach implies that:

* **State deltas** for collections can be expressed as a sequence of membership changes, i.e., items being *inserted* or *removed*.
* A **batch** of membership changes can be processed as a single, atomic update operation.
* Individual **items** can be *"modified"* even if they are formally *immutable*, by *replacing* one or more existing items with new versions.

---

## Representation of State Change

In line with this replication strategy, SharedState represents a **state change** as an object with three optional fields:

```javascript
{ remove: [], insert: [], reset: false }
```

### Parameters
* `remove`: Array of IDs (`string[]`, default: `[]`) for items to be removed from the collection.
* `insert`: Array of [Items] (`Item[]`, default: `[]`) to be inserted into the collection.
* `reset`: Boolean (`boolean`, default: `false`). When `true`, clears the collection prior to applying insertions. (`remove` is ignored).

### Execution Rules
1. `remove` is executed ahead of `insert`.
2. `insert` performs an automatic `replace` if an item with the same `id` already exists in the collection.
3. `reset` clears all items in the collection before applying `insert`, causing any `remove` array to be safely ignored.


---


This design combines high expressiveness with efficient representation of state changes, resulting in reduced network overhead.

| State Changes | Effect |
| :--- | :--- |
| `{ remove: [], insert: [], reset: false }` | **No Changes** |
| `{ remove: [], insert: [...], reset: false }` | **Insert or Replace Items** |
| `{ remove: [...], insert: [], reset: false }` | **Delete Items** |
| `{ remove: [...], insert: [...], reset: false }` | **Delete Items + Insert or Replace Items** |
| `{ reset: true }` | **Clear all Items** |
| `{ insert: [...], reset: true }` | **Clear all Items + Insert Items** |
