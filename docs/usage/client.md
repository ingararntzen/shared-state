# Client Setup & Usage

> Guide for importing, initializing, and using the SharedState JavaScript client library.

---

## 1. CDN & Bundle Downloads

Pre-compiled JavaScript client bundles are published live to GitHub Pages on every build. Choose the bundle format that fits your application toolchain:

- **[sharedstate.es.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js)** — ES6 Module (Unminified)
- **[sharedstate.es.min.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.es.min.js)** — ES6 Module (Minified)
- **[sharedstate.iife.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.iife.js)** — IIFE Script Tag (Unminified)
- **[sharedstate.iife.min.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.iife.min.js)** — IIFE Script Tag (Minified)
- **[sharedstate.cjs.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.cjs.js)** — Node.js / CommonJS
- **[sharedstate.cjs.min.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.cjs.min.js)** — Node.js / CommonJS (Minified)

---

## 2. Including the SDK in Web Applications

### ES6 Module Import Syntax (Recommended)
In modern web applications or native `<script type="module">` tags:

```html
<script type="module">
  import { SharedStateClient, SharedInteger, SharedMap } from "https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js";

  // 1. Initialize client connection
  const client = new SharedStateClient("ws://localhost:9000");

  // 2. Instantiate a shared variable
  const counter = new SharedInteger(client, "/app/items/vars", "counter");
</script>
```

### Traditional IIFE Script Tag
For traditional HTML pages without module bundlers:

```html
<script src="https://ingararntzen.github.io/shared-state/dist/sharedstate.iife.js"></script>
<script>
  // Constructors are exposed under the global SHAREDSTATE namespace
  const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
  const myMap = new SHAREDSTATE.SharedMap(client, "/app/items/store", "myMap");
</script>
```

### Node.js / CommonJS
In server-side Node.js or build tools requiring CommonJS:

```javascript
const { SharedStateClient, SharedMap } = require("./dist/sharedstate.cjs.js");
const client = new SharedStateClient("ws://localhost:9000");
```

---

## 3. Initializing `SharedStateClient`

The `SharedStateClient` manages the persistent WebSocket connection, automatic heartbeat ping-pong, clock synchronization, and subscription multiplexing.

```javascript
import { SharedStateClient } from "./dist/sharedstate.es.js";

// Connect to local or remote SharedState server
const client = new SharedStateClient("ws://localhost:9000");

// Wait for connection establishing (optional, as primitives handle auto-queueing)
await client.connection.connectedPromise();
```

---

## 4. Shared Application Primitives

SharedState provides familiar programming abstractions backed by online state replication:

### Shared Variable Types
- **`SharedBoolean`**: Synchronized boolean flag (`true`/`false`).
- **`SharedInteger`**: Synchronized integer with atomic `.inc(delta)` / `.dec(delta)` helper methods.
- **`SharedFloat`**: Synchronized floating-point value.
- **`SharedString`**: Synchronized string value.

```javascript
import { SharedInteger, SharedString } from "./dist/sharedstate.es.js";

// Instantiate shared counter variable
const counter = new SharedInteger(client, "/app/items/vars", "counter", {
  allowUndefined: false,
  defaultValue: 0
});

// Increment counter
counter.inc(1);
```

### Shared Collection Types
- **`SharedMap`**: Synchronized key-value dictionary (`.set(key, val)`, `.delete(key)`, `.get(key)`).
- **`SharedSet`**: Synchronized unique element set (`.add(item)`, `.delete(item)`, `.has(item)`).
- **`SharedTree`**: Hierarchical parent-child node structure.

```javascript
import { SharedMap } from "./dist/sharedstate.es.js";

const users = new SharedMap(client, "/app/items/data", "users");

// Mutate map locally (optimistic update replicated to server and peers)
users.set("user_101", { name: "Alice", role: "admin" });
```

---

## 5. Reactive Event Subscriptions

Use `.on('change', handler, { init: true })` to bind UI components reactively to state updates. Setting `{ init: true }` fires the callback immediately with current local state upon subscription.

```javascript
// Bind UI to counter changes
counter.on("change", () => {
  document.getElementById("count-display").textContent = counter.value;
}, { init: true });

// Listen to map changes
users.on("change", () => {
  console.log("Current users:", users.entries());
}, { init: true });
```

---

## 6. Real-World Application Example

To see a complete walkthrough combining a `SharedMap` and a `SharedString` in a multi-user collaborative application, explore the **[Example Walkthrough](/usage/example.md)**.
