[ItemCollection]: /design/item_collections/item_collection
[ItemCollections]: /design/item_collections/item_collection

# SharedState Architecture

The SharedState framework implements state sharing within a client-server architecture, as shown in [Figure 1](#fig-1). 

<figure id="fig-1" style="text-align: center; margin: 2rem 0;">
  <img src="/images/SharedStateService.png" alt="SharedState Architecture Diagram" style="max-width: 100%; height: auto; margin: 0 auto; display: block;" />
  <figcaption style="font-size: 0.9em; opacity: 0.8; margin-top: 0.5rem;">
    <strong>Figure 1:</strong> State sharing with SharedState Service: (i) Client 1 (top-left) issues an update request (red arrow) to an ItemCollection (blue circle) hosted by the SharedState Service (bottom). (ii) SharedState Service broadcasts update notifications (green arrows) to all subscribing clients (top). (iii) Upon notification receipt, each client updates its local replica (blue circle).
  </figcaption>
</figure>

---

## Primary-Backup with Client-Side Replicas

The SharedState Architecture can be described as a primary-backup architecture where the server is the **primary** and each client hosts its own private **replica**.

- **Client queries** target the local replica, ensuring state access with zero delay.

- **Update requests** target the SharedState service, and their effects are only committed by the client after notification is received from the server. As such, the basic **update delay** corresponds to network **round-trip time (RTT)**. However, to improve responsiveness, update delay is masked by speculatively applying updates to the local replica *before* dispatching requests to the server. This effectively ensures **zero update delay** (see [Local Speculative Updates](#local-speculative-updates)). Moreover, update requests are not blocking, and may be streamed to the server in rapid succession, if needed.

---

## Per-Resource State Sharing

The SharedState framework allows clients to observe state changes in individual resources (blue circles in Figure 1). This is achieved by letting clients subscribe to change notifications for named resources. This effectively means that state sharing is implemented on a per-resource basis, as opposed to per-service or per data model.

---

## Network Connection

Clients communicate with the server over a WebSocket connection.

If the connection is lost, the SharedState client will automatically attempt to reconnect. If the connection is successfully re-established after a reconnect attempt, the client will automatically resubscribe to resume the session. The SharedState service does not persist client subscriptions. Clients can still resume a session after server restart, by re-subscribing on re-connect.

::: tip Automated Reconnect
The SharedState client automatically attempts to reconnect after a network failure, but gives up and terminates after **3 consecutive failed attempts**. Reconnect attempts are delayed by 1, 2, and 3 seconds respectively. After the connection has been terminated, the client must be re-initialized (e.g., reload page) in order to resume operation.
:::


---

## Network Messages

Clients exchange the followign messages with the SharedState server:

1. **Subscribe**: Client subscribes to change notification for a set of resources.
2. **Unsubscribe**: Clients unsubscribe from a set of resources.
3. **Update request**: Client request modifications to a resource.
4. **Initial state**: Client receives notification of state change, following subscription or re-subscription.
5. **Change notifications**: Clients receive notifications of state change in resources they subscribe to, following state modification.

All messages are multiplexed over a single WebSocket connection.

---

## Consistency

- The SharedState architecture ensures that the server remains the single source of truth for resource state. 
- The server ensures sequential processing of update requests (per resource) by assigning a monotonically increasing revision number to each update. 
- Clients receive the initial state upon subscription and are guaranteed to receive every subsequent state update in order.
- Clients can detect that a message is lost, and trigger re-connect to restore the integrity of the session.

This ensures **eventual consistency** for client replicas, as long as the connection remains open. Client replicas will **not** be updated at exactly the same instant, but will always be updated in the same order and eventually reach the same stable state if no more updates are dispatched.

---

## Conditional Updates

Some update operations, such as `inc` or `append`, are relative in nature, meaning that the requested state modification is derived from the current state. In the SharedState model, this may occasionally lead to surprising effects, given that current state on the client is generally trailing behind the current state on the server. Moreover, updates from other clients may be processed in the mean time.

Importantly, this does not lead to an inconsistent state. The server is always the single source of truth, and it will always process updates in the order they are received. However, it may lead to some flickering and unexpected behavior, in the perspective of the user. 

To possibly remedy this situation, the SharedState server offers support for **conditional updates**. Conditional update request will only be processed by the server, if no intermediary updates have occured. This is implemented by comparison of version numbers, on the server. Clients attach the current version number with the update request. If the version number of the request is outdated, the server will not process the update.


---

## Batch Updates

The SharedState server supports **batch updates** on a per-resource basis. This means that a set of **remove**, **insert**, and/or **replace** operations may be processed together, as an atomic operation, ensuring that intermediate states are not visible to any client. 

Batch updates are currently only supported for items within a single resource collection, **not** across multiple resources, or servers. Batchin support in these context should be considered in the context of [Transactions](#transaction-support).

---

## Local Speculative Updates

Speculative updates allow clients to optimistically apply updates locally before the server has processed them. This eliminates update latency for the client issuing the update request, allowing SharedState resources to be used directly in interactive scenarios where smooth, responsive updates are crucial.  

Importantly, local updates are **speculative** in nature, and may require a **rollback** if the connection is lost or if the server rejects the update request. The SharedState client handles this automatically. For the application, state rollback is indistinguishable from "normal" state updates.

---

## Transaction Support

Transaction support would allow clients to perform an update operation which involves modification of multiple resources, potentially across different servers. Transactions would ensure:

- That intermediate states are not visible to any client, and
- That all modifications are either processed successfully across all resources, or not processed at all. 

::: tip Status
Transaction support is **not currently supported**.
:::

---

## Partial Resource Observation

The SharedState architecture specifies that client-side replication is performed on a per-resource basis. In circumstances where resources represent large datasets, this may be inefficient, particularly if clients only need to observe a small subset of the resource. The ability to observe only a limited subset of a resource can be achieved through various types of **persistent filters**. 


### Filtering Approaches

- **Topic-Based Filtering**: Filter is a **list of topics**, requiring an equality check on a given item property. 
- **Range-Query Filtering**: Filter is a **time range**, requiring the evaluation of simple expressions involving one or two item properties (e.g., `ts >= start && ts <= end`).
- **Content-Based Filtering**: Filter is expressed in a **filter expression language** and evaluated directly against individual items within a collection. The filter is sensitive to item schema and data format.

### Client-Side vs. Server-Side Filtering

- **Client-side filtering** is easy to implement, yet does not provide the benefit of reduced network traffic.
- **Server-side filtering** provides reduced network traffic, yet may increase complexity on the server side, thereby potentially reducing efficiency and scalability.

### Filtering Initial State vs. Change Notifications

Partial observation requires that filtering applies both to the initial state of a resource and to subsequent change notifications. 

In a scenario with a large dataset and relatively small updates, filtering may be most consequential during resource **initialization**, yielding increased server processing but reduced network load. However, **initialization** only concerns a single client, whereas filtering costs associated with **change notifications** may apply to a large number of clients, on an ongoing basis. As such, server-side filtering may be highly beneficial, even if it may leads to increased processing delays for individual requests. 

### Server-Side Filtering Complexity

Server-side filtering requires that the server performs additional processing on behalf of individual clients or groups of clients. Filters must be defined as serializable expressions by the client and associated with specific resource subscriptions.

- Server-side filtering costs depend on the filtering approach: **Content-Based Filtering** is generally more expensive than **Topic-Based Filtering** or **Range-Query Filtering**.
- Server-side filtering costs may be significantly reduced if the server does not have to evaluate all elements of a dataset, but can instead rely on indexing support for identifying the relevant subset. This approach is most relevant for **Topic-Based Filtering** and **Range-Query Filtering**. For example, if the server is set up with indexing support for the `ts` property of time-dependent resources, range filtering may be satisfied through a simple index lookup.
- In the context of resource updates, server-side filtering requires the the prior state of the resource is available for filter evalutation. This is required to defect items that used to be accepted by the filter, but are no longer accepted after the update. (This may alternatively be handled on the client side.)

::: tip Status
Partial observation is currently **not supported**.
:::
