[Item]: /design/representation/item_collection#item
[Items]: /design/representation/item_collection#item
[ItemCollection]: /design/representation/item_collection#itemcollection
[ItemCollections]: /design/representation/item_collection#itemcollection

# Replication Strategy

> The SharedState framework adopts a **passive**, **delta-based** replication strategy.


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

SharedState is an instance of **passive replication**. This aligns directly with the framework's core design goal of providing a domain-agnostic, generic mechanism for state sharing (see [Domain-Agnostic Server](/concept/introduction#domain-agnostic-server)). Importantly, this passive replication strategy allows application-specific business logic and commands to be implemented on top of the framework, without requiring modifications to framework.

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
<a id="representation-of-state-change"></a>

To achieve domain-agnostic **delta-based passive replication**, state changes in SharedState are modeled as membership deltas over an [ItemCollection].

Rather than defining custom, domain-specific mutation commands (e.g. `append`, `splice`, `update_field`), all state transitions are expressed as membership changes over [ItemCollections]:

- `remove`: Remove items.
- `insert`: Insert new items or replace existing items.
- `reset`: Clear all items ahead of `insert`.

Domain specific update function can be built on top of this basic machanism. 

> For a detailed specification of state change representation, see [Changes](/design/representation/item_collection#changes).
