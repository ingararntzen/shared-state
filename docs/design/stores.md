# Item Stores

The SharedState server decouples network protocol handling and client subscription routing from storage persistence. Storage implementations are provided by pluggable **ItemStores**.

An `ItemStore` manages persistent item collections under a specific store name within the 3-part path hierarchy:

$$\text{Path} = \text{/app-name/store-name/channel-name}$$

Developers can extend SharedState by implementing custom `ItemStores` to back collections with SQLite, MySQL, Redis, or specialized databases (e.g., time-series or geospatial engines).

---

## ItemStore Interface

Every backend `ItemStore` module exposes a factory function `get_store(config)` and implements the following asynchronous Python interface:

```python
def get_store(config: dict) -> ItemStore:
    """Instantiate the store with backend options (DB URI, credentials, table names, etc.)."""
    ...

class ItemStore:
    # Optional attribute indicating if computed diffs include previous item state
    oldstate_included: bool = False

    async def open(self) -> None:
        """Initialize database connection pools or file handles."""
        ...

    async def close(self) -> None:"""Gracefully release database connections or file handles."""
        ...

    async def get(self, app: str, chnl: str) -> list[dict]:
        """Fetch all current items for (app, chnl) as a list of dictionaries."""
        ...

    async def update(self, app: str, chnl: str, changes: dict) -> list[dict]:
        """Atomically apply changes ({ insert, remove, reset }) and return computed diffs."""
        ...

    async def apps(self) -> list[str]:
        """Return a list of all distinct application names stored in this backend."""
        ...

    async def channels(self, app: str) -> list[str]:
        """Return a list of all channel names stored under a given application."""
        ...
```

---

## Server Invocation Lifecycle

The `SharedStateServer` invokes methods on registered `ItemStore` instances at specific operational stages:

| Server Event / Operation | Protocol Trigger | Invoked Method | Purpose |
| :--- | :--- | :--- | :--- |
| **Server Startup** | `serve_forever()` startup sequence | `await store.open()` | Connects to database engines and prepares queries. |
| **Server Shutdown** | `shutdown()` cleanup sequence | `await store.close()` | Flushes writes and closes connection pools. |
| **Client Fetch** | WebSocket `REQUEST` `GET /app/store/chnl` | `await store.get(app, chnl)` | Retrieves current state snapshot to construct client `REPLY`. |
| **State Mutation** | WebSocket `REQUEST` `PUT /app/store/chnl` | `await store.update(app, chnl, changes)` | Mutates storage atomically and computes diffs for multicast `NOTIFY`. |
| **Subscription Resync** | Client reconnects or updates `/subs` | `await store.get(app, chnl)` | Fetches a full snapshot to perform a unicast `NOTIFY` reset to the client. |
| **Admin Introspection** | REST `GET /api/stores`, `GET /api/apps` | `await store.apps()` & `await store.channels(app)` | Powers the Admin UI overview and REST resource inspection. |

---

## Storage Engine Flexibility

Decoupling storage implementations allows swapping backend persistence mechanisms without changing client code, proxy objects, or network protocols:

* **Built-in `ItemsStore`** (`sharedstate.stores.items_store`): Built-in generic store supporting SQLite and MySQL backends.
* **In-Memory SQLite**: Lightweight, zero-configuration store for automated testing and rapid prototyping.
* **Relational DBs (MySQL / PostgreSQL)**: Production-grade persistent storage with ACID guarantees.
* **Specialized & Time-Aware Stores**: Custom `ItemStore` implementations can provide specialized indexing for historical timestamps (`ts`), interval queries (`itv`), or geospatial coordinate indexing (`lat`, `lng`).
