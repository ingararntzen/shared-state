[ItemCollection]: /design/representation/item_collection
[ItemCollections]: /design/representation/item_collection
[ItemProvider]: /design/representation/item_provider
[ItemProviders]: /design/representation/item_provider
[App Objects]: /design/abstraction/objects
[Variables]: /design/abstraction/objects
[Collections]: /design/abstraction/objects
[Changes]: /design/representation/item_collection#changes
[Conditional Updates]: /design/mechanism/consistency#conditional-updates


# Item Provider Design

> The SharedState client mirrors server-side [ItemCollections] locally, as [ItemProviders].


`ItemProvider` represents a local, in-memory proxy to a server-side [ItemCollection], continuously synchronized with server-side state changes.


## Synchronous Queries

`ItemProvider` allows applications and higher-level abstractions to query its state **synchronously**:

- `size`: Returns total item count in local state.
- `has_item(id)`: Returns boolean indicating whether item `id` exists.
- `get_item(id)`: Returns stored item object or `undefined`.
- `get_items()`: Returns an array snapshot of all stored items.

::: tip Note 
`ItemProvider` is not typically accessed directly by application code, but rather serves as the underlying state provider for higher-level [App Objects] (such as Shared Maps, Shared Sets, and Shared Variables).
:::

## Asynchronous Updates

`ItemProvider` allows applications to request an **asynchronous** state update.

```js
update_items(changes, { dropIfModified: false }) 
```

- Returns a `Promise` that is resolved when the corresponding change has become visible to a local query operation.
- `changes`: [Changes] to be applied to the [ItemCollection].
- `options.dropIfModified`: (`Boolean`, default: `false`). If true, the update is dropped if concurrent modifications occurred on the server, see [Conditional Updates].


::: tip Note
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


## Local Updates & Optimistic Execution

The SharedState client supports **local updates**, where state changes are recorded locally by an `OptimisticItemProvider` wrapper before being dispatched to the server. This ensures **zero-delay updates** for client applications, supporting highly responsive interactive UI updates. For details concerning the technical approach, see [Speculative Updates](/design/mechanism/consistency#speculative-updates).


::: tip Note
Even though optimistic `update` operations have **zero delay**, they are still **asynchronous**. This is by design, ensuring that update semantics remain consistent across all update operations.
:::
