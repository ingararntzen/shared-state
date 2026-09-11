---
name: shared-state
description: Guidelines and code examples for using the JavaScript client library of the SharedState real-time state synchronization service.
---

# Shared State JS Client Guide

This guide provides API definitions and code examples for developing applications with the JavaScript client library of the SharedState real-time state synchronization service.

---

## 1. Core Idea

The core idea of SharedState is to program with generic programming abstractions—such as variables and collection types—like always, but, crucially, to re-imagine these abstractions for an online world.

This means that abstractions like (`integer`, `string`, `map`, `set`) are no longer just memory-backed constructs within the scope of a single process. Instead, they become true online abstractions: backed by persistent state hosted on a server, and accessible for real-time observation and mutation by connected clients globally.

This idea inspires a family of online programming abstractions: `SharedInteger`, `SharedFloat`, `SharedString`, `SharedBoolean`, `SharedMap`, `SharedSet`.

Similar to traditional programming, application code will be expressed through state access and mutations. Crucially, thouth, since the state is online, state updates are no longer synchronous. This implies a shift to a reactive programming model, where rendering is driven by state changes, and state mutations are driven by user interaction.

---

## 2. Script Includes and Client Instantiation

The JavaScript client can be imported either as an ES module or via a global script tag (IIFE). Instantiating `SharedStateClient` initializes the WebSocket connection manager.

### ES Module Import

```html
<script type="module">
    import { SharedStateClient, SharedInteger, SharedMap } from "./dist/sharedstate.es.js";

    const client = new SharedStateClient("ws://localhost:9000");
</script>
```

### Global Script Import (IIFE)

```html
<script src="./dist/sharedstate.iife.js"></script>
<script>
    const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
```

---

## 3. Examples

SharedState applications follow a decoupled reactive pattern: user interactions mutate state via abstractions, and UI renders reactively in response to state change events.

### Example A: SharedInteger Counter

```html
<!-- UI HTML Elements -->
<button id="decrementBtn">-</button>
<span id="counterValue">0</span>
<button id="incrementBtn">+</button>

<script type="module">
    import { SharedStateClient, SharedInteger } from "./dist/sharedstate.es.js";

    const client = new SharedStateClient("ws://localhost:9000");
    const counter = new SharedInteger(client, "/myapp/mitems/counter");

    // 1. User Actions -> Mutate State
    document.querySelector("#incrementBtn").onclick = () => {
        counter.increment();
    };
    document.querySelector("#decrementBtn").onclick = () => {
        counter.decrement();
    };

    // 2. State Change -> Render UI ({ init: true } delivers initial state immediately)
    counter.on("change", (val) => {
        document.querySelector("#counterValue").textContent = val;
    }, { init: true });
</script>
```

### Example B: SharedMap Slide Collection

```html
<!-- UI HTML Elements -->
<button id="addSlideBtn">Add Slide</button>
<div id="slidesGallery"></div>

<script type="module">
    import { SharedStateClient, SharedMap } from "./dist/sharedstate.es.js";

    const client = new SharedStateClient("ws://localhost:9000");
    const slidesMap = new SharedMap(client, "/app/items/slides");

    // 1. User Actions -> Mutate State
    document.querySelector("#addSlideBtn").onclick = () => {
        const slideId = "slide_" + Date.now();
        slidesMap.set(slideId, { id: slideId, title: "New Slide", color: "#38bdf8" });
    };

    window.deleteSlide = (slideId) => {
        slidesMap.delete(slideId);
    };

    // 2. State Change -> Render UI
    slidesMap.on("change", (changes) => {
        const slides = Array.from(slidesMap.values());
        const gallery = document.querySelector("#slidesGallery");
        
        gallery.innerHTML = slides.map(s => `
            <div style="background-color: ${s.color}; padding: 1rem; margin: 0.5rem 0;">
                <h3>${s.title}</h3>
                <button onclick="deleteSlide('${s.id}')">Delete</button>
            </div>
        `).join("");
    }, { init: true });
</script>
```

---

## 4. Core Concepts

### Instantiating Programming Abstractions

SharedState programming abstractions (`SharedVariable`, `SharedInteger`, `SharedMap`, etc.) are instantiated immediately after client initialization. They automatically handle queuing and state replication regardless of connection timing.

```javascript
const client = new SharedStateClient("ws://localhost:9000");

// Instantiated directly with client and target path
const counter = new SharedInteger(client, "/myapp/mitems/counter");
const slidesMap = new SharedMap(client, "/myapp/items/slides");
```

### Event Subscriptions and `{ init: true }`

High-level abstractions implement the `Events` interface (`on`, `off`, `once`). The `"change"` event is emitted whenever state updates locally or from remote clients.

Passing `{ init: true }` in event options ensures the callback receives the current state immediately upon subscription, as well as on all subsequent changes:

```javascript
abstraction.on("change", (statePayload) => {
    // Render or update application state
}, { init: true });
```

### Variable Types

Single-value abstractions backed by server paths:

- **`SharedVariable`**: Generic untyped single value (`get()`, `set(val)`).
- **`SharedBoolean`**: Boolean state variable.
- **`SharedString`**: String state variable.
- **`SharedInteger`**: Integer counter supporting `increment()` and `decrement()`.
- **`SharedFloat`**: Floating point number variable.
- **`SharedRecord`**: Object/record value variable.
- **`SharedArray`**: Array value variable.

### Map and Set Collections

Collection abstractions backed by server paths:

- **`SharedMap`**: Key-value map emulating standard JavaScript `Map`:
  - `set(key, value)`, `get(key)`, `has(key)`, `delete(key)`, `clear()`
  - `size`, `keys()`, `values()`, `entries()`, `forEach(cb)`
- **`SharedSet`**: Set of unique items:
  - `add(value)`, `has(value)`, `delete(value)`, `clear()`, `size`

---

## 5. Advanced Material

### Underlying Client Primitives

Behind high-level abstractions, `SharedStateClient` provides direct access to lower-level resource handles:

```javascript
// Path-exclusive collection resource
const coll = client.get_collection_resource("token", "/myapp/items/mycollection");
const items = coll.get_items();
coll.update_items({ insert: [...], remove: [...], reset: false });

// Item-exclusive value resource
const valRes = client.get_value_resource("token", "/myapp/items/mycollection", "item123");
```

### Connection Management

WebSocket transport lifecycle and connection state can be inspected via `client.connection`:

```javascript
// Wait for connection to open
await client.connection.connectedPromise();

// Connection event hooks
client.connection.on_connect = () => console.log("Connected");
client.connection.on_disconnect = () => console.log("Disconnected");
```

### Server Clock Synchronization

Access server-synchronized time and latency measurements:

```javascript
// Current estimated server UTC time (seconds since Unix epoch)
const serverTime = client.serverclock.now();

// Estimated transit latency (seconds)
const latency = client.serverclock.trans;

// Estimated clock skew between client and server (seconds)
const skew = client.serverclock.skew;
```
