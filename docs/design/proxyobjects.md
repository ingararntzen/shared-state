# Proxy Collections & Proxy Objects

> - Client-side proxy classes mirror online server resources in local memory.
> - Proxies enable synchronous local queries and handle automatic state reconciliation.

For client API documentation, see [Client API Reference](/client-api/).

---

## Client Proxy Architecture

SharedState provides client-side proxy abstractions to shield developers from raw WebSocket message parsing and event wiring:

### `ProxyCollection`
* Represents a full server-side resource collection.
* Maintains a synchronized local `Map` of items.
* Supports partial updates (`insert`, `remove`, `reset`).
* Dispatches change events to registered application callbacks.

### `ProxyObject`
* Wraps a single item within a `ProxyCollection`.
* Designed for items whose `state` holds an array or structured sub-elements.
* Simplifies managing items within a single parent item's state.




## Lifecycle Methods

### `acquire_collection(path)` / `acquire_object(path, name)`
* Idempotently instantiates a local proxy instance for `path`.
* Automatically registers a subscription to `path` on the server if not already active.
* Returns the cached proxy instance for subsequent calls on the same path.

### `release(path)`
* Unsubscribes from `path` on the server.
* Terminates local proxy instances and clears registered event callbacks.
* Cleans up local proxy maps (`_coll_map`, `_obj_map`).

---

## Best Practice Pattern

In component-based UI frameworks (such as React, Vue, or Svelte):

```javascript
// On component mount
const todos = client.acquire_collection("/myapp/items/todos");

// On component unmount
client.release("/myapp/items/todos");
```

Explicitly releasing paths ensures that unmounted UI views do not leave orphaned event listeners in memory or waste server bandwidth receiving unwanted notifications.




---

## Conceptual Evolution: Concept A vs. Concept B

During development, two distinct mental models emerged for proxy objects:

1. **Concept A (Item Wrapper)**: `ProxyObject` acts as a specialized wrapper around a single item in a collection, allowing multiple variables to share one server collection.
2. **Concept B (Simplified Collection Mirror)**: `ProxyObject` mirrors a full resource, but replaces the entire payload on updates without partial diffing.

The client library maintains clean separation: `ProxyCollection` handles partial diffing, while `ProxyObject` handles item-level wrapping.



