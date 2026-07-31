# WebSocket Protocol

> - SharedState uses a clean JSON message envelope over a single WebSocket connection.
> - The protocol supports request-reply tunneling and push-based change notifications.

For client library details, see [Client API](/client-api/).

---

## Message Envelope Structure

All WebSocket frames are serialized JSON objects containing three core fields: `type`, `cmd`, and payload attributes.

### Message Types

1. **`REQUEST`**: Sent by client to request an action on a resource path.
2. **`REPLY`**: Sent by server in response to a specific `REQUEST`, matched via a `tunnel` ID field.
3. **`MESSAGE`**: Sent asynchronously by server to broadcast notifications (`NOTIFY`) to subscribers.

---

## Command Set

| Command (`cmd`) | Type | Purpose |
| :--- | :--- | :--- |
| **`GET`** | `REQUEST` | Fetches state snapshot for a path (e.g. `/path` or `/subs`). |
| **`PUT`** | `REQUEST` | Submits batch delta updates or updates subscription list (`/subs`). |
| **`NOTIFY`** | `MESSAGE` | Broadcasts atomic change deltas (`{ remove, insert, reset }`) to subscribed clients. |

---

## Example Flow: Update & Broadcast

```
Client A                   Server                   Client B
   │                         │                         │
   ├── PUT /myapp/items ────►│                         │
   │   (REQUEST, tunnel: 1)  ├── Commit Batch          │
   │                         ├── NOTIFY /myapp/items ─►│
   │◄── REPLY (ok: true) ────┤   (MESSAGE)             │
   │    (tunnel: 1)          │                         │
```




### 3. Subscription Reset Request (`PUT /subs`)

Whenever subscriptions change—or when a client reconnects—the client posts its complete active subscription set to `/subs` as a single batch update:

```json
{
  "type": "REQUEST",
  "cmd": "PUT",
  "path": "/subs",
  "arg": {
    "insert": [
      ["/myapp/items/room1-chat", {}],
      ["/myapp/items/config", {}]
    ],
    "reset": true
  },
  "tunnel": 0
}
```

