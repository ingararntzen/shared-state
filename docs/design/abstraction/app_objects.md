# Application Objects (Variables & Collections)

> **Application Objects** (or App Objects) are Layer 2 programming abstractions that map real-time shared state paths into intuitive data structures, including Variables, Maps, and Sets.

---

## 1. Resource Binding Models

Application Objects bind to shared state paths to establish real-time synchronization over underlying WebSocket streams:

### Collection Path Binding (3 Segments)
Shared Collections bind directly to a **3-segment path**:
```
/app_name/store_name/resource_name
```
All elements within the collection share this path prefix, enabling range querying, structured grouping, and multi-item replication over a single provider stream.

### Variable Tuple Binding `(path, name)`
Shared Variables bind to a **`(path, name)` tuple**:
- **`path`**: A 3-segment collection path (`/app/store/resource`).
- **`name`**: A string key identifying the item within that collection (`item_id`).

The variable's fully-qualified resource identifier is derived as `path + "/" + name` (e.g., `/app/store/vars/score`).

---

## 2. Collection Paradigms

SharedState provides two primary collection models:

### `SharedMap` (Key-Value Dictionary)
Represents a key-value dictionary mapping string keys (`item.id`) to item state payloads. It mirrors standard JS `Map` semantics (`get`, `set`, `has`, `delete`, `keys`, `values`, `entries`).

### `SharedSet` (Unordered Structural Set)
Represents an unordered collection of unique elements. To enforce element uniqueness over a distributed network without requiring explicit database keys, Shared Sets use a multi-tiered identity resolution pipeline:

```
Element to Add / Query
          │
          ▼
Does options.key function exist? ───(Yes)───► Use Key Extractor Return Value
          │
         (No)
          ▼
Is Object with .id property? ─────(Yes)───► Use String(element.id)
          │
         (No)
          ▼
Fallback: Canonical Order-Independent JSON Hashing
```

1. **Custom Key Extractor**: Programmers can supply a custom key function (e.g. `user => user.userId`).
2. **Explicit `.id` Property**: If an element is an object containing an `.id` property, `String(elem.id)` is used.
3. **Canonical JSON Serialization Fallback**: For arbitrary objects, object keys are recursively sorted prior to JSON stringification. This guarantees that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce identical keys and evaluate as equal elements in the set.

---

## 3. Variable Value Resolution & Typing Model

While underlying communication streams transfer arbitrary JSON payloads, Shared Variables enforce type validation and fallback resolution guarantees.

```
Incoming Stream / Read Request
             │
             ▼
    Has Valid Server State? ───(Yes)───► Use Server Value (Source of Truth)
             │
            (No)
             ▼
   Is Initializing + Has initialValue? ───(Yes)───► Use initialValue (Optimistic Seed)
             │
            (No)
             ▼
      Use defaultValue ───► (or undefined if allowUndefined is true)
```

### Precedence Hierarchy
1. **Server State (Source of Truth)**: Valid server data delivered over WebSocket sync overrides local seeds and defaults.
2. **`initialValue` (Optimistic Seed)**: A client-side seed value available immediately upon local instantiation **strictly before initial synchronization completes** with the server.
3. **`defaultValue` (Type Fallback)**: When an item is absent on the server or holds an invalid type payload (e.g., string `"hello"` stored in a `SharedInteger`), reading the variable returns `defaultValue` (e.g., `0` for integer, `""` for string, `{}` for object).
4. **`allowUndefined`**: Controls whether `undefined` is accepted as a valid state when no item exists on the server.

---

## 4. Reference Equality & Identity Caching

All Application Objects enforce **reference equality**: instantiating or querying an object bound to the exact same path or `(path, name)` tuple returns the **same object instance in memory** (`objA === objB`).

- **Unified UI State**: Multiple UI components binding to the same path or variable share the exact same object reference, preventing divergent local states or race conditions.
- **Provider Sharing**: A single `ProxyCollection` provider handles underlying WebSocket subscriptions, version tracking, and delta distribution for all consumers of that path.

---

## 5. Event-Driven Reactivity & Streaming

Application Objects provide non-blocking local reads backed by real-time push synchronization.

- **Non-blocking Local Reads**: Querying state (`.value`, `.get()`, `.values()`) is an instant local memory lookup.
- **Direct Change Streaming**: Collections emit change events matching native client-side delta payloads (`{ insert: Map, remove: Set, reset: Boolean, version: Number }`).
- **State Hydration (`{ init: true }`)**: Listening with `{ init: true }` triggers initial state delivery immediately before streaming live delta updates.
