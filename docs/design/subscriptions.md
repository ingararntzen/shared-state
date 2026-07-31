[Path]: (design/resources)
[Paths]: (design/resources)
[SharedState Client]: (design/framework.md/#sharedstate-client)
[SharedState Server]: (design/framework.md/#sharedstate-server)



# Subscriptions

> - Client subscriptions are maintained locally and synchronized with the server over a single WebSocket connection.
> - The server broadcasts change notification to subscribing clients.

---

## Client-Side Subscriptions

The [SharedState Client] manages subscriptions to server resources identified by [Paths].

### 1. Internal Data Structure

The client maintains an in-memory `Map` associating resource [Paths] to `option` objects. 

```javascript
Map(2) {
  "/myapp/items/room1-chat" => {},
  "/myapp/items/config"     => {}
}
```

::: tip Future Extension 
The `options` object is currently not in use, but is reserved for future support for **filters** or **range queries** (see [partial resource observation](/overview/architecture.md#partial-resource-observation)).
:::




### 2. Subscription Logic

The client provides primitives for subscribing or unsubscribing to individual [Paths]:

```javascript
sub(path, options = {})
unsub(path)
```

* **`sub(path, options)`**: Adds or updates an entry for `path` in the local subscription `Map`, then sends a subscription reset request (`PUT /subs`) to the server with the updated local state.
* **`unsub(path)`**: Removes the `path` entry from the local subscription `Map`, then sends a subscription reset request (`PUT /subs`) to the server with the updated local state.

::: tip Automatic resubscription 
Client subscriptions are automatically reset on the server whenever the network connection is established or re-established.
:::


---

## Server-Side Subscriptions

The [SharedState Server] maintains subscription state in a `Dictionary`, where active WebSocket client handles map to a `Dictionary` of client specific subscriptions. 
 

### 1. Internal Data Structure

```python
Dict({
    <WebSocket client_1>: {
        "/myapp/items/room1-chat": {},
        "/myapp/items/config": {}
    },
    <WebSocket client_2>: {
        "/myapp/items/room1-chat": {}
    }
})
```

### 2. Subscription Logic

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

