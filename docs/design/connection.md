[SharedState Client]: (design/framework.md/#sharedstate-client)
[SharedState Server]: (design/framework.md/#sharedstate-server)

# Connection

> The [SharedState Client] maintains a single **WebSocket** connection to the [SharedState Server] over which it communicates all messages.

---


## Connection Object

- `on_connect()`
- `on_disconnect()`
- `on_error()`
- `connect()`
- `disconnect()`
- `is_connected()`

## Bi-directional Communication

- send()
- request()
- update()
- on_message()
- on_reply()


# Disconnected

- re-subscrie on connect()
- re-send pending messages
- fail requests with timeout