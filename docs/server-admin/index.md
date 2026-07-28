# Server Setup & Administration

The SharedState Python server manages WebSocket clients, route dispatching, and backend storage service execution.

## Starting the Server

### Via CLI
```sh
poetry run sharedstate-server
```

### Via Python Script
```python
import asyncio
from sharedstate.ss_server import SharedStateServer

server = SharedStateServer(
    port=9000,
    services=[
        {
            "name": "items",
            "module": "items_service",
            "config": {
                "db_type": "sqlite",
                "db_name": ":memory:"
            }
        }
    ]
)

asyncio.run(server.start())
```

---

## Single-Port HTTP REST & Status Endpoints

The server runs HTTP REST administration endpoints on the same port as WebSockets:

* `GET /api/config`: Returns active server configuration and loaded service metadata.
* `GET /api/services`: Returns loaded service statistics and app counts.
* `GET /api/subscriptions`: Returns current client subscription mappings.
* `GET /api/log/http`: Fetches recent HTTP access logs.
* `GET /api/log/ws`: Fetches recent WebSocket access logs.
