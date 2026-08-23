# Server Setup & Administration

The SharedState Python server manages WebSocket clients, route dispatching, and backend ItemStore execution.

## Starting the Server

### Via CLI
```sh
poetry run sharedstate-server config.json
```

### Via Python Script
```python
import asyncio
from sharedstate.ss_server import SharedStateServer

server = SharedStateServer(
    port=9000,
    stores=[
        {
            "name": "items",
            "module": "items_store",
            "config": {
                "db_type": "sqlite",
                "db_name": ":memory:"
            }
        }
    ]
)

asyncio.run(server.serve_forever())
```

---

## Single-Port HTTP REST & Status Endpoints

The server runs HTTP REST administration endpoints on the same port as WebSockets:

* `GET /api/config`: Returns active server configuration and loaded store metadata.
* `GET /api/stores`: Returns loaded store statistics and app counts.
* `GET /api/subs`: Returns current client subscription mappings.
* `GET /api/connections`: Returns connected client IP list.
