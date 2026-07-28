# Atomic Change Deltas

> - State updates and broadcast notifications use atomic batch delta payloads.
> - Multiple item modifications within a collection are transmitted and applied together.

For resource details, see [Resources](/design/resources.md).

---

## Delta Payload Structure

SharedState communicates state changes using a standardized delta dictionary:

```javascript
{
  "remove": ["id1", "id2"],
  "insert": [
    { "id": "id3", "state": { "title": "New Task" } }
  ],
  "reset": false
}
```

### Delta Fields

* **`remove`**: Array of item IDs to be deleted from the collection.
* **`insert`**: Array of items `{ id, state }` to be added or replaced in the collection.
* **`reset`**: Boolean flag. When `true`, the local proxy collection purges all existing items before applying `insert` payloads.

---

## Atomic Batching Rationale

Packaging multiple operations into a single delta payload provides two key benefits:

1. **Network Efficiency**: Transmitting precise deltas rather than whole collection snapshots reduces bandwidth usage drastically.
2. **Single-Server Batch Isolation**: All updates within a delta payload are committed atomically on the server. Intermediate states are never visible to other clients.
