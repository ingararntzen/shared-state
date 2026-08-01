
# Replication Strategy

Online state replication depends on the communication of **state changes** across the network. The SharedState framework exchanges **state changes** in the following three scenarios.

  1. **initialization**: the server dispatches **state changes** to the client as part of state initialization. This occurs whenever the clients subscribes to a new resource, or changes the nature of a subscription (e.g. range restrictions).
  2. **update**: the client dispatches desired **state changes** to the server as part of an update request.
  3. **notify**: the server broadcasts **state changes** as notifications to all subscribing clients. This occurs whenever a resource has been updated.

## Passive vs. active replication

In the literature there is a distinction between **passive** and **active** replication.

- **passive replication**: The client sends the **new state** to the primary, which in turn forwards copies of this state to all replicas.
- **active replication**: The client sends a **deterministic command** to the primary, which in turn forwards the same command to all replicas. The **new state** results from applying the command to the **current state**.

SharedState is an instance of **passive** replication. This is in line with the overall design goals of the framework, focusing on a domain agnostic and broadly applicable mechanism for state sharing (see [Dumb Server](/overview/paradigm#dumb-server)). This particularly ensures that application-specific commands can be supported on the clients side, without requiring support from the underlying replication strategy.

## Full-state vs. delta-based replication

Replication systems may further be classified as **full-state** or **delta-based**.

- **full-state**: The client sends the **full state** to the primary, which in turn forwards copies to all replicas.
- **delta-based**: The client sends a **state delta** to the primary, which in turn forwards the same **state delta** to replicas. The **new state** is constructed by applying the **state delta** to the **current state**.

SharedState uses **delta-based** replication in order to reduce bandwith usage. This is particularly important when large resources are subjected to small changes.


## Unit of replication

> SharedState uses **collections** of **immutable items** as the unit of replication.

Importantly, this implies:

- that **state deltas** for **collections** can be expressed as a sequence of **membership changes** for the collection: i.e., **items** being **deleted** or **inserted**;
- that such a sequence of **membership changes** can be implemented as a single, atomic operation; and
- that individual **items** may be **replaced** in a single operation, by **deleting** the **current item** and **inserting** the **new item** in its place. In effect, this allows for **mutation** of **immutable items**.


## State Changes

In line with the above replication strategy, SharedState defines **state changes** as an object with three optional fields:

```javascript
{remove:[], insert:[], reset:false}
```

**Parameters:**
* `remove`: list of `id`'s (default: []). Items to be removed from the collection. 
* `insert`: list of [Items] (default: []). Items to be inserted into the collection. 
* `reset`: boolean (default: false). Reset collection. 

**Rules:**
- `remove` is performed ahead of `insert`.
- `insert` implies `replace` if Item with same `id` is already in the collection.
- `reset` implies that `remove` is ignored, and that all items in the collection are removed ahead of `insert`.

::: tip Reset flag
The reset flag allows collections to be cleared without specifying the `id`'s of all its Items.
:::

This design ensures combines high expressivenes with efficient representation of state changes, resulting in low network overhead.


| UPDATE ARGUMENT                           | EFFECT                 |
|-------------------------------------------|------------------------|
| {remove:[], insert:[], reset:false}       | NOOP                   |
| {remove:[], insert:[...], reset:false}    | INSERT ITEMS           |
| {remove:[...], insert:[], reset:false}    | REMOVE ITEMS           |
| {remove:[...], insert:[...], reset:false} | REMOVE + INSERT ITEMS  |
| {reset:true}                              | RESET                  |
| {insert:[...], reset:true}                | RESET + INSERT ITEMS   |






