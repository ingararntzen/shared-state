[ItemCollection]: /design/item_collections/item_collection]
[ItemCollections]: /design/item_collections/item_collection]
[ProxyCollection]: /design/item_collections/client_proxies
[ProxyCollections]: /design/item_collections/client_proxies
[Variables]: /design/abstractions/variables
[Collections]: /design/abstractions/collections

# Proxy Collection

> The SharedState framework mirrors server-side [ItemCollections] to client-side [ProxyCollections].


`ProxyCollection` represents a local, in-memory replica of a server-side [ItemCollection], continuously synchronized to the server-side state.


## Synchronous Queries

`ProxyCollection` allows applications to synchronously query its state:

- `size`: Returns total item count in local state.
- `has_item(id)`: Returns boolean indicating whether item `id` exists.
- `get_item(id)`: Returns stored item object or `undefined`.
- `get_items()`: Returns an array snapshot of all stored items.


> Note: `ProxyCollection` is not used directly by applications, but rather serve as a state provider for multiple programming abstractions, including [Variables] and [Collections].  


## Asynchronous Updates

- Applications may request updates to server-side [ItemCollections] by calling the `update_items(changes)` method on the `ProxyCollection`. 
- The update operation is asynchronous as it requires network transfer and server processing. The effects of update operations are therefore not available locally until later, when change notifications have been received from the server.
- If multiple update operations are invoked during the same microtask, they are aggregated into a single request.


## Server Notifications

The Shared client automatically updates the `ProxyCollection` in response to notifications of state change received from the server.

