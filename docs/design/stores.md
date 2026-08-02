# Item Store

- SharedState Server decouple server logic from backend ItemStores
- Extensible with new types of ItemStores
- Describe possible indexing support, Timestamps, Intervals, Geographical Coordinates
- Interface intended for internal store objects, not as bridge to external services.
- Asynchronous implementation.
- Explain API - and which operations are needed at different stages of server operations.


---

## ItemStore Interface

Every backend storage service in SharedState implements a pluggable module interface exposing two core asynchronous methods:

* **`get(app, resource)`**: Retrieves the current state snapshot for a resource.
* **`update(app, resource, changes)`**: Applies a batch delta update (`{ remove, insert, reset }`) and returns calculated diffs.

---

## Storage Engine Flexibility

Decoupling storage implementations allows developers to swap backend persistence mechanisms without modifying client code or WebSocket protocols:

| Service Implementation | Storage Engine & Best Use Case |
| :--- | :--- |
| **`items_service`** | Default generic storage service. |
| **MySQL / MariaDB** | Production persistent storage with full relational DB backing. |
| **SQLite (In-Memory / File)** | Fast, lightweight persistence ideal for local testing, embedded systems, or dev environments. |
| **Time-Aware Custom Services** | Specialized services with timestamp (`ts`) or interval (`itv`) indexing for historical range queries. |
