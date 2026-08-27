[Path]: /design/item_collections/item_collection#path
[Paths]: /design/item_collections/item_collection#path
[SharedState Client]: /design/overview#sharedstate-client
[SharedState Server]: /design/overview#sharedstate-server



# Subscriptions

> - Client subscriptions are maintained locally and synchronized with the server.
> - The server broadcasts change notification to subscribing clients.

---

## Client-side Subscriptions

The SharedState client manages subscriptions to server resources identified by [Paths].

### Internal Data Structure

The client maintains an in-memory `Map` associating resource [Paths] to `subscription` objects. 

```javascript
Map(2) {
  "/myapp/items/room1-chat" => {},
  "/myapp/items/config"     => {}
}
```

::: tip Note 
The `subscription` object is currently empty, but is intended to include **filters** or **range queries** (see [partial resource observation](/concept/architecture#partial-resource-observation)).
:::




### Subscription Logic

The SharedState client manages subscriptions internally (in `_subs_map`) and **resets** server-side subscriptions using the following method:

```javascript
_sync_subs() {
    const subs = Array.from(this._subs_map.entries());
    const payload = {
        insert: subs,
        reset: true
    };
    return this._request(MsgCmd.PUT, "/subs", payload);
}
```

- The SharedState client automatically **resets** subscriptions whenever the network connection is established or re-established. 
- If the `_subs_map` is empty, the client is no longer subscribed to any resources.
- `_subs_map` is initalized when the client loads its resource configuration.




---

## Server-side Subscriptions

The SharedState server maintains subscription state in its `Clients` class, which maps active WebSocket client connections to a `Dictionary` of client specific subscriptions.
 

### Internal Data Structure

```python
dict({
    <WebSocket client_1>: dict({
        "/myapp/items/room1-chat": {},
        "/myapp/items/config": {}
    }),
    <WebSocket client_2>: dict({
        "/myapp/items/room1-chat": {}
    })
})
```

### Subscription Logic

The server logic accesses and updates client subscriptions via the `Clients` class.

```python
class Clients:
    def register(self, ws_client):
        """Register new client connection."""

    def unregister(self, ws_client):
        """Unregister client connection and clear its subscriptions."""

    def get_subs(self, ws_client):
        """Get active subscriptions for given client."""

    def put_subs(self, ws_client, subs):
        """Set/replace active subscriptions for client."""

    def clients(self, path):
        """Get all active client WebSocket clients subscribed to path."""
```

