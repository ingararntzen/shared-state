[ItemCollection]: /design/representation/item_collection
[ItemCollections]: /design/representation/item_collection
[ProxyCollection]: /design/representation/proxy_collection
[ProxyCollections]: /design/representation/proxy_collection
[Variables]: /design/abstraction/variables
[Collections]: /design/abstraction/collections
[Changes]: /design/representation/item_collection#changes
[Conditional Updates]: /design/mechanism/consistency#conditional-updates


# Proxy Collection

> The SharedState client mirrors server-side [ItemCollections] as local [ProxyCollections].


`ProxyCollection` represents a local, in-memory replica of a server-side [ItemCollection], continuously synchronized with server-side state changes.


## Synchronous Queries

`ProxyCollection` allows applications to query its state **synchronously**:

- `size`: Returns total item count in local state.
- `has_item(id)`: Returns boolean indicating whether item `id` exists.
- `get_item(id)`: Returns stored item object or `undefined`.
- `get_items()`: Returns an array snapshot of all stored items.


> Note: `ProxyCollection` is not used directly by applications, but rather serve as a common backend for various programming abstractions, including [Variables] and [Collections].


## Asynchronous Updates

`ProxyCollection` allows application to request an **asynchronous** state update.

```js
update_items(changes, {conditional:false}) 
```

- Returns a `Promise` that is resolved when the corresponding change has become visible to a local `query` operation.
- `changes`: [Changes] to be applied to [ItemCollection].
- `options.conditional`: (`Boolean`, default: `false`). If true, the update is conditional, see [Conditional Updates].


::: warning Note
Due to its asynchronous nature, the effects of `update` operations never become immediately visible, i.e. to a `query` operation within the same microtask. This is consistent with a reactive programming model, where reactive rendering is decoupled from update requests.
```js
// synchronous
variable.set(42)
console.log(variable.value) // value === 0

// asynchronous
variable.set(43).then(() => {
    console.log(variable.value) // value === 43
}) 
```
:::


## Local Updates

The SharedStaate client supports **local updates**, implying that updates are recorded locally at the client, before being dispatched to the server. This ensures **zero delay updates** for the client applications, thereby supporting highly responsive interactive state change. For details concering the technial approach, see [Speculative Updates](/design/mechanism/consistency#speculative-updates).


::: tip Note
Even though `update` operations have **zero delay**, they are still **asychronous**. This is by design, ensuring that update semantics remain consistent across all update operations, whether they target remote or local state. 
:::



