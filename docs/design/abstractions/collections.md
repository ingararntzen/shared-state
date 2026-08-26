# Collection Types & Data Structures

Developer-facing Layer 2 collection types provide higher-level data structure abstractions built on top of Layer 1 item collections.

---

## Path Structure

Collection abstractions bind to **3-segment paths**:

```
/app_name/store_name/resource_name
```

---

## Available Collection Classes

### `BaseCollection`
The minimal base class for all Layer 2 collection types.
- Provides `size`, `get_items()`, `.provider` getter, and `eventify` `"change"` events.

### `SharedMap` (`"Map"`)
Provides a key-value dictionary abstraction over item collections:
- `set(key, value)`: Inserts or updates the item with ID `key` and value `value`.
- `get(key)`: Returns state for `key` or `undefined`.
- `delete(key)`: Deletes `key`.
- `has(key)`: Returns boolean indicating existence of `key`.

### `SharedSet` (`"Set"`)
Provides an element-based Set abstraction:
- `add(element)`: Adds `element` to the set.
- `delete(element)`: Removes `element` from the set.
- `has(element)`: Checks if `element` exists in the set.
- `values()` / `[Symbol.iterator]()`: Iterates over elements.

---

## SharedSet Element Hashing Strategy

To support element equality without requiring explicit IDs:

1. **Custom Key Extractor (`options.key`)**:
   Programmers can specify a custom key function in `client.load()`:
   ```javascript
   client.load({
       users: { type: "Set", path: "/app/store/users", options: { key: (user) => user.userId } }
   });
   ```

2. **Explicit `.id` Property**:
   If the element is an object with an `.id` property (e.g. `{ id: "u_1", name: "Alice" }`), `String(elem.id)` is used.

3. **Canonical JSON Serialization Fallback**:
   For arbitrary objects, keys are recursively sorted before JSON stringification. This guarantees that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce identical keys and evaluate as equal elements.
