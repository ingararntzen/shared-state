# Client Subscriptions & Single-Connection Multiplexing

## Context & Overview
Clients maintain subscriptions to resource paths on the server. Subscriptions are registered by writing to a reserved path (`/subs`).

---

## Single-Connection Multiplexing

Because an application state is composed of many independent fine-grained resources, a single client application may subscribe to multiple resource paths simultaneously.

Rather than opening separate network connections per resource:
* **One WebSocket Connection**: All client subscriptions, queries, and updates travel over a single multiplexed WebSocket connection.
* **Efficient Traffic Routing**: The server routes broadcast notifications only to clients actively subscribed to that specific resource path.

---

## Symmetric Subscription Model

In SharedState, subscriptions are **client-side state replicated to the server's in-memory store**. This is the exact inverse of data resources (which are server-side state replicated to client proxies):

* **Client Ownership**: Clients maintain their active subscription manifest locally (`_subs_map`).
* **Server Replication**: The client mirrors its subscription list to the server's in-memory `/subs` resource.

---

## Reconnection & Recovery Protocol

When network dropouts occur or the server restarts:

1. The client reconnects automatically via `on_connect()`.
2. The client re-sends its local subscription map to `/subs` with `reset: true`.
3. The server receives the subscription payload and executes a `unicast_reset`, fetching and sending fresh snapshots for all subscribed paths.
4. The client proxy resets its internal map and notifies observers.

This mechanism ensures seamless recovery after server restarts or network disruptions without requiring server-side session persistence or event log replay.
