# Client Setup

> How to import and use the SharedState client JavaScript library.

---

## Bundle Downloads

JavaScript client bundles are published live to GitHub Pages on every build. Choose the bundle format that fits your application toolchain:

- **[sharedstate.es.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js)** — ES6 Module
- **[sharedstate.es.min.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.es.min.js)** — ES6 Module (Minified)
- **[sharedstate.iife.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.iife.js)** — IIFE Script Tag
- **[sharedstate.iife.min.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.iife.min.js)** — IIFE Script Tag (Minified)
- **[sharedstate.cjs.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.cjs.js)** — Node.js / CommonJS
- **[sharedstate.cjs.min.js](https://ingararntzen.github.io/shared-state/dist/sharedstate.cjs.min.js)** — Node.js / CommonJS (Minified)

---

## Bundle Imports

### ES6 Module Import Syntax
Used when building applications with modern bundlers (Vite, Webpack, Rollup) or natively in browsers via `<script type="module">`:

```html
<script type="module">
  import { SharedStateClient } from "https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js";
</script>
```

### IIFE Script Tag
For plain HTML web pages without build tools or module support. Regular script import assigns the `SHAREDSTATE` object to the global `window` object.

```html
<script src="https://ingararntzen.github.io/shared-state/dist/sharedstate.iife.js"></script>
```

### Node.js / CommonJS
For usage with Node.js or build tools requiring CommonJS:

```javascript
const { SharedStateClient } = require("./dist/sharedstate.cjs.js");
```


---
## Programming Abstractions

SharedState currently provides the following programming abstractions:


### Shared Variables

Shared variables represent a single value which can be accessed (`.get()`, `.value`) or assigned to (`.set(value)`). 

- **`SharedVariable`** - Shared variable without type restriction. 
- **`SharedBoolean`**: Shared variable restricted to boolean type (`true|false`).
- **`SharedInteger`**: Shared variable restricted to integer type (`0`). 
- **`SharedFloat`**: Shared variable restricted to number type (`0.0`).
- **`SharedString`**: Shared variable restricted to string type (`""`).
- **`SharedRecord`**: Shared variable restricted to object type (`{}`).
- **`SharedArray`**: Shared variable restricted to array type (`[]`).


`SharedBoolean` defines custom method `toggle()`. `SharedInteger` and `SharedFloat` define custom methods `inc(delta)` and `dec(delta)`. The remaining objects do not introduce type-specific methods. 


### Shared Collections

Shared collections represent abstractions built over a collection of elements.

- **`SharedMap`**: Synchronized key-value dictionary (`.set(key, val)`, `.delete(key)`, `.get(key)`).
- **`SharedSet`**: Synchronized unique element set (`.add(item)`, `.delete(item)`, `.has(item)`).

---
## Imports

Programming abstractions are exported as independent classes within the sharedstate namespace. These are the most important objects exported from the SharedState bundle (`client/index.js`):

```html
<script type="module">
  import { 
    // Client
    SharedStateClient, 
    // Connection States
    ConnectionState,
    // Variables
    SharedVariable,
    SharedBoolean,
    SharedInteger,
    SharedFloat,
    SharedString,
    SharedRecord,
    SharedArray,
    // Collections
    SharedSet, 
    SharedMap 
  } from "https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js";
</script>
```

---

## Initialization, Setup, and Usage

The `SharedStateClient` sets up a WebSocket connection to the server and manages connection recovery and subscriptions under the hood. 

```js
// Client Initialization
const client = new SharedStateClient("ws://localhost:9000");
```


### Application Setup

> The client is immediately ready for application setup.

Programming abstractions and event listeners can be defined immediately after the client object is created:

```js
// Setup abstractions
const users = new SharedMap(client, "/app/items/users");
const counter = new SharedInteger(client, "/app/items/vars", "counter", {
  allowUndefined: false,
  defaultValue: 0
});

// Setup event listeners
users.on("change", () => {
  console.log("Users changed:", users.entries());
}, { init: true });
counter.on("change", () => {
  console.log("Counter changed:", counter.value);
}, { init: true });
```

Notably, until the WebSocket connection has been established, application objects will either be empty or reflect default or initial state.

### Runtime Usage

> State mutation (e.g., `set()`, `inc()`) requires an open WebSocket connection. 

If an update request is attempted before the connection has been established, or during a temporary disconnect-reconnect cycle, application objects will throw an `Error`. 

Applications may inspect the connection status and/or wait for the connection to become available.

```js
// check connection status
if (client.connection.connected) {
  console.log("Connected to server");
} else {
  console.log("Not connected to server");
}

// wait for the connection to become available
await client.connection.connectedPromise();
```

Connection state (`client.connection.state`) may be used to provide immediate feedback to the user that interactivity is temporarily suspended, and to make sure the UI is reflecting this situation in a sensible way, including the subsequent return to normal operation. 

Alternatively, connection state may be used to buffer update requests, and to automatically flush them to the server once the connection becomes operational. 


