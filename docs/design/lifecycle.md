# Resource Lifecycle (`acquire` / `release`)

> - Proxy instances and server subscriptions are managed using an acquire/release lifecycle.
> - Prevents memory leaks and unnecessary network notifications when UI components unmount.

For proxy usage, see [Proxy Collections & Objects](/design/proxy-models.md).

---

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
