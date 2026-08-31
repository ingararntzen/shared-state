[Items]: /design/item_collections/item_collection#item
[ItemCollections]: /design/item_collections/item_collection#itemcollection
[ProxyCollection]: /design/item_collections/client_proxies

# Update & Query Semantics

> The SharedState framework provides a uniform, reactive programming model where abstractions represent remote resources, but are made accessible to the programmer as local objects.


---

## Introduction


In **single-process programming**, application-specific logic is defined through **assignment** and **mutation** of general purpose programming abstractions, such as:

- **Variable types**: `boolean`, `integer`, `string`, `float`.
- **Collection types**: `List`, `Map`, `Set`, `Tree`, `Graph`.

> The core philosophy of SharedState is to adapt this model to the online world. This means that programming is still based on similar abstractions, but, importantly, that the abstractions live externally to the process, and may therefore be shared across multiple processes.

This idea immediately inspires a new set of programming abstractions:
- **Variable types**: `SharedBoolean`, `SharedInteger`, `SharedString`, `SharedFloat`.
- **Collection types**: `SharedList`, `SharedMap`, `SharedSet`, `SharedTree`, `SharedGraph`.

These new abstractions closely mirror their single-process counterparts, but with the important difference that they are proxies to remote resources, and that their state mutation is therefore principally an **asynchronous** operation.



Two immediate takeaways:

- This represents a programming model which is familiar, in the sense that application logic is still defined in terms of general purpose programming abstractions, but different, in the sense that these objects do not behave exactly as their single-process counterparts. 

- This represents a shift away from the typical way of organizing distributed applications, where state is often centralized in a monolithic date model. By contrast, the ShareState model 






## 1. Remote-First Reactive Contract


- **all resources are treated as remote**, even when backed by low-latency client-side memory replicas. 

To maintain consistency and predictability across distributed networks, SharedState separates reads and writes into two distinct operational contracts:

* **Queries are Synchronous**: Reading state (e.g. `collection.get_item(id)` or `variable.value`) executes synchronously against the client's local memory cache. It never blocks on network I/O.
* **Updates are Non-Blocking & Asynchronous**: Mutating state (e.g. `collection.update_items()` or `variable.set()`) is non-blocking upon invocation, immediately returning a `Promise` representing server processing and acknowledgment. The ultimate state effects of the update are decoupled from the immediate execution task.

---

## 2. Uniformity Across All State Objects

This programming contract extends **uniformly across all objects in the framework**:

- Remote server-backed collections (`ProxyCollection`).
- Local reactive variables (`SharedVariable`).
- Optimistically updated speculative collections (`SpeculativeProxyCollection`).

By applying the exact same update/query contract to every object, developers do not need to rewrite application logic or handle different API patterns when transitioning between local state and shared server state.

---

## 3. Optimistic Updates (`{ optimistic: true }`)

By default, SharedState enables **optimistic local updates** (`optimistic: true`).

When a client dispatches an update request:
- The edit is immediately written to an isolated local speculative overlay (`SpeculativeProxyCollection`).
- Queries and UI subscribers immediately observe the change with **0ms latency**, masking server round-trip delays.
- When the server responds, the overlay entry is reconciled with confirmed server state.

If an application requires strict server confirmation before reflecting a change, developers can pass `{ optimistic: false }` to disable overlay masking for a specific update operation:

```js
// Update dispatches to server, but local UI waits for server ACK before updating
await collection.update_items(changes, { optimistic: false });
```

---

## 4. Synchronous Visibility Exception (`{ synchronous: true }`)

In standard operation, update effects are decoupled from the immediate execution task to mirror remote resource behavior. 

However, certain application workflows (such as tight UI input loops or synchronous form validation) require local update effects to become visible immediately within the same microtask / event-loop tick.

SharedState accommodates this through an explicit opt-in option, `{ synchronous: true }` (disabled by default):

```js
// Update effect becomes visible immediately within the current task
collection.update_items(changes, { synchronous: true });
```

When `{ synchronous: true }` is specified:
- The optimistic overlay is updated immediately within the same microtask.
- Reactive event handlers and query lookups observe the updated value synchronously before the current task yields control back to the event loop.
