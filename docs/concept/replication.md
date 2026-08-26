[Item]: /design/item_collections/item_collection#item
[Items]: /design/item_collections/item_collection#item
[ItemCollection]: /design/item_collections/item_collection#itemcollection
[ItemCollections]: /design/item_collections/item_collection#itemcollection

# Replication Strategy

> - The SharedState framework adopts a **passive**, **delta-based** replication strategy.
> - **State changes** are expressed as atomic membership changes (`remove`, `insert`, `reset`) over **collections of immutable items**.

---

## State Changes in SharedState

Online state replication depends on communicating **state changes** across the network. In the SharedState framework this occurs in three key scenarios:

1. **Initialization**: The server dispatches **state changes** to the client as part of state initialization. This occurs whenever a client subscribes to a new resource or changes the nature of a subscription (e.g., range restrictions).
2. **Update**: The client dispatches desired **state changes** to the server as part of an update request.
3. **Notification**: The server broadcasts **state changes** as notifications to all subscribing clients whenever a resource is updated.

---

## Passive vs. Active Replication

In distributed systems literature, a core distinction exists between **passive** and **active** replication:

- **Passive Replication**: The client transmits the desired **new state** or **state delta** to the primary server, which forwards copies to all replicas.
- **Active Replication**: The client transmits a **deterministic command** to the primary server, which forwards the same command to all replicas. The **new state** is computed independently on each replica by executing the command against local state.

SharedState is an instance of **passive replication**. This aligns directly with the framework's core design goal of providing a domain-agnostic, generic mechanism for state sharing (see [Dumb Server Approach](/concept/paradigm#5-dumb-server-approach)). Importantly, this passive replication strategy allows application-specific business logic and commands to be implemented on top of the framework, without requiring changes to the underlying replication strategy.

---

## Full-state vs. Delta-based Replication

Replication systems can further be classified as **full-state** or **delta-based**:

- **Full-State Replication**: The client transmits the **full state** to the primary, which forwards copies to all replicas.
- **Delta-Based Replication**: The client transmits only a **state delta** (the difference) to the primary, which forwards the same **state delta** to all replicas. The **new state** is constructed locally by applying the **state delta** to the local state.

SharedState uses **delta-based replication** to minimize network bandwidth consumption. This is especially vital when large resources undergo small, frequent modifications.

---

## Unit of Replication

> SharedState uses **collections** of **immutable items** as the unit of replication.

Importantly, this approach implies that:

* **State deltas** for collections can be expressed as a sequence of membership changes, i.e., items being **inserted** or **removed**.
* A sequence of membership changes is executed as a single, atomic update operation.
* Individual **items** can be **replaced** in a single atomic step by **removing** the existing item and **inserting** the new item in its place. In effect, this enables controlled **mutation** over **immutable items**.

---

## Representation of State Change

In line with this replication strategy, SharedState represents a **state change** as an object with three optional fields:

```javascript
{ remove: [], insert: [], reset: false }
```

### Parameters
* **`remove`**: Array of item IDs (`string[]`, default: `[]`) to be removed from the collection.
* **`insert`**: Array of [Items] (`Item[]`, default: `[]`) to be inserted into the collection.
* **`reset`**: Boolean (`boolean`, default: `false`). When `true`, clears the collection prior to applying insertions.

### Execution Rules
1. `remove` is executed ahead of `insert`.
2. `insert` performs an automatic `replace` if an item with the same `id` already exists in the collection.
3. `reset` clears all items in the collection before applying `insert`, causing any `remove` array to be safely ignored.

::: tip Reset Flag Usage
The `reset` flag allows an entire collection to be cleared or re-initialized without needing to specify the IDs of all individual items.
:::

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
