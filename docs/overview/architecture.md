# SharedState Architecture

The SharedState framework implements state sharing within a client-server architecture, as shown in [Figure 1](#fig-1). 

<figure id="fig-1" style="text-align: center; margin: 2rem 0;">
  <img src="/images/SharedStateService.png" alt="SharedState Architecture Diagram" style="max-width: 100%; height: auto; margin: 0 auto; display: block;" />
  <figcaption style="font-size: 0.9em; opacity: 0.8; margin-top: 0.5rem;">
    <strong>Figure 1:</strong> State sharing with SharedState Service: (i) Client 1 (top-left) issues an update request (red arrow) to an Item Collection hosted by the SharedState Service (bottom). (ii) SharedState Service broadcasts update notifications (green arrow) to all subscribing clients (top). (iii) Upon notification receipt, each client updates its local replica. (iv) Client queries local replica (not illustrated).
  </figcaption>
</figure>

---

## Primary-Backup with Client-Side Replicas

The SharedState Architecture can be described as a primary-backup architecture where the server is the **primary** and each client hosts its own private **replica**.

- **Client queries** target the local replica, ensuring synchronous state access with zero delay.

- **Update requests** from clients target the SharedState service and only take effect locally after notification is received from the server. As such, the update latency is at least one network round-trip time. Updates are asynchronous and may be streamed to the server (see [Reactive Programming Model](/overview/paradigm.md#4-reactive-programming)). To improve responsiveness, update latency may be avoided locally by speculatively applying updates to the local replica before dispatching requests to the server (see [Local Speculative Updates](#local-speculative-updates)).

---

## Per-Resource State Sharing

The SharedState framework allows clients to observe state changes in individual resources (blue circles in Figure 1). This is achieved by letting clients subscribe and unsubscribe to state notifications for named resources. This effectively means that state sharing is implemented on a per-resource basis, as opposed to per-service or per data model.

---

## Network Connection

Clients communicate with the server over a WebSocket connection. Clients may exchange messages with the server as long as the connection is open.

If the connection is lost, the SharedState client will automatically attempt to reconnect. If the connection is successfully re-established after a reconnect attempt, the client will automatically resubscribe. This allows clients to seamlessly resume the session, even if the server connection is interrupted for a shorter period. The SharedState service manages client subscriptions in-memory as long as the connection is open, but does not persist them or keep them between client sessions.  

::: tip Automated Reconnect
The SharedState client attempts to reconnect every 10 seconds. If the connection cannot be re-established after 3 consecutive attempts, the connection remains closed, and the client must actively be reloaded to re-establish the connection.  
:::


---

## Network Communication

When the connection is open, clients may exchange messages with the SharedState server to:

1. **Subscribe** to state changes in resources they are interested in.
2. **Unsubscribe** from notifications for resources they no longer need to observe.
3. **Dispatch update requests** to modify the state of resources.
4. **Receive initial state** for subscribed resources upon connection.
5. **Receive change notifications** for resources they are subscribed to.

Clients multiplex all messages over a single WebSocket connection.

---

## Consistency

- The SharedState architecture ensures that the server remains the single source of truth for resource state. 
- The server ensures ordering of update requests per resource by assigning a monotonically increasing revision number to each update. 
- Clients receive the initial state upon subscription and are guaranteed to receive every subsequent state update in order.

This ensures **eventual consistency** for client replicas as long as the connection remains open. Client replicas will **not** be updated at exactly the same instant, but will always be updated in the same order and eventually reach the same stable state if no more updates are dispatched.

---

## Relative Updates

Relative updates are **not** supported by the server, as they would limit efficiency by potentially forcing both a read operation and application-specific logic ahead of processing an update (see [Dumb Server Approach](/overview/paradigm.md#approach)).

Relative updates can instead be achieved from the client side, based on the current state of the local replica. This, however, may open up surprising effects if multiple clients attempt relative updates concurrently. To avoid this scenario, the server may drop update requests that are not based on the current state version, thus ensuring that only one relative update is applied at a time.

---

## Batch Updates

The SharedState server supports **batch updates**. This means that a set of **remove**, **insert**, and/or **replace** operations may be processed together, ensuring that clients cannot see intermediate states. 

::: tip Note
Batch updates are currently only supported for items within a single resource collection, **not** across multiple resources. Batch updates across resources should be considered in the context of [Transactions](#transactions) instead.
:::

---

## Local Speculative Updates

Speculative updates allow clients to optimistically apply updates locally before the server has processed them. This eliminates update latency for the client issuing the update request, allowing SharedState resources to be used directly in interactive scenarios where smooth, responsive updates are crucial.  

Importantly, local updates are **speculative** and may require a **rollback** if the connection is lost, if the server rejects the update request, or if the update request conflicts with updates from other clients.


::: warning Implementation Status
Local speculative updates with automatic rollback are currently **not supported**. The planned approach is to realize this functionality as an optional feature so that it can be applied on-demand for specific resources.
:::


---

## Transactions

Transactions would allow clients to perform a set of operations across multiple resources, or even across multiple servers. Transaction support would ensure:

- That intermediate states are not visible to any client, and
- That all operations are either processed successfully, or not processed at all. 

::: warning Implementation Status
Multi-resource and multi-server transactions are currently **not supported**.
:::

---

## Partial Resource Observation

The basic SharedState architecture specifies that client-side replication is performed on a per-resource basis. In circumstances where resources represent large datasets, this may be inefficient, particularly if clients only need to observe a small subset of the resource. This can be addressed through various forms of **filtering**.


### Filtering Approaches

- **Topic-Based Filtering**: Filter is a **list of topics**, requiring an equality check on a single property of the element. 
- **Range-Query Filtering**: Filter is a **time range**, requiring the evaluation of mathematical expressions on one or more properties of the elements (e.g., `ts >= start && ts <= end`).
- **Content-Based Filtering**: Filter is expressed in a **filter expression language** and evaluated directly against individual elements within a dataset, sensitive to their specific data format or schema.

### Client-Side vs. Server-Side Filtering

- **Client-side filtering** is easy to implement, yet does not provide the benefit of reduced network traffic.
- **Server-side filtering** provides reduced network traffic, yet may increase complexity on the server side and reduce efficiency and scalability.

### Filtering Initial State vs. Change Notifications

Partial observation requires that filtering applies both to the initial state of a resource and to subsequent change notifications. 

In a scenario with a large dataset and relatively small updates, filtering may be most consequential during resource **initialization**, both in terms of server processing and network load. However, **initialization** only concerns a single client, whereas filtering costs associated with **change notifications** may also be large if resources are shared by a large number of clients.

### Server-Side Filtering Complexity

Server-side filtering requires that the server perform additional processing on behalf of individual clients or groups of clients. Filters must be defined as serializable expressions by the client and associated with specific resource subscriptions.

- Server-side filtering costs depend on the filtering approach: **Content-Based Filtering** is generally more expensive than **Topic-Based Filtering** or **Range-Query Filtering**.
- Server-side filtering costs may be significantly reduced if the server does not have to evaluate all elements of a dataset, but can instead rely on indexing support for identifying the relevant subset. This approach is most relevant for **Topic-Based Filtering** and **Range-Query Filtering**. For example, if the server is set up with indexing support for the `ts` property of time-dependent resources, range queries may be satisfied through a simple index lookup.


::: warning Implementation Status
Partial observation is currently **not supported**.
:::
