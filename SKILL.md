---
name: shared-state
description: Guidelines and code examples for using the JavaScript client library of the Shared State real-time sharing service.
---

# Shared State JS Client Guide

This guide provides API definitions and decoupled reactive code examples for developing applications with the JavaScript client library of the SharedState real-time data sharing service.

---

## 1. Core Idea

The core idea of SharedState is to program with generic programming abstractions—such as variables and collection types—like always, but, crucially, to re-imagine these abstractions for an online world.

This means that abstractions like (`integer`, `string`, `map`, `set`) are no longer just memory-backed constructs within the scope of a single process. Instead, they become true online abstractions: backed by persistent state hosted on a server, and accessible for real-time observation and mutation by connected clients globally.

This idea inspires a family of online programming abstractions: `SharedInteger`, `SharedFloat`, `SharedString`, `SharedBoolean`, `SharedMap`, `SharedSet`.

Similar to traditional programming, application code will be expressed through state access and mutations. Crucially, though, since the state is online, state updates are no longer synchronous. This implies a shift to a reactive programming model, where rendering is driven by state changes, and state mutations are driven by user interaction.

---

## 2. Script Includes and Client Instantiation

The JavaScript client can be imported either as an ES module or via a global script tag (IIFE). Instantiating `SharedStateClient` initializes the WebSocket connection manager.

### ES Module Import

```html
<script type="module">
    import { 
        ConnectionState,
        SharedStateClient, 
        SharedVariable, 
        SharedBoolean, 
        SharedInteger, 
        SharedFloat, 
        SharedString, 
        SharedRecord, 
        SharedArray, 
        SharedMap, 
        SharedSet 
    } from "https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js";

    const client = new SharedStateClient("ws://localhost:9000");
</script>
```

### Global Script Import (IIFE)

```html
<script src="https://ingararntzen.github.io/shared-state/dist/sharedstate.iife.js"></script>
<script>
    const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
```

---

## 3. Examples

SharedState applications follow a decoupled reactive pattern: user interactions mutate state via abstractions, and UI renders reactively in response to state change events.

### Example A: SharedInteger Counter

```javascript
// Instantiated with client, path prefix, and variable name
const counter = new SharedInteger(client, "/myapp/items/vars", "counter", { defaultValue: 0 });

// 1. User Actions -> Mutate State
document.querySelector("#incrementBtn").onclick = () => {
    counter.inc();
};
document.querySelector("#decrementBtn").onclick = () => {
    counter.dec();
};

// 2. State Change -> Render UI ({ init: true } delivers initial state immediately)
counter.on("change", (val) => {
    document.querySelector("#counterValue").textContent = val;
}, { init: true });
```

### Example B: SharedMap Slide Collection

```javascript
// Instantiated with client and collection path
const slidesMap = new SharedMap(client, "/myapp/items/slides");

// 1. User Actions -> Mutate State (Add / Delete)
document.querySelector("#addSlideBtn").onclick = () => {
    const slideId = "slide_" + Date.now();
    slidesMap.set(slideId, { id: slideId, title: "New Slide", color: "#38bdf8" });
};

document.querySelector("#deleteSlideBtn").onclick = () => {
    slidesMap.delete("slide1");
};

// 2. State Change -> Render UI
slidesMap.on("change", (changes) => {
    const slides = Array.from(slidesMap.values());
    renderGallery(slides);
}, { init: true });
```

---

## 4. Core Concepts

### Instantiating Programming Abstractions

SharedState programming abstractions are created directly using `client` and their target `path`:

- **Path**: string path  (`/app/store/resource`) which identifies a single resource on the server. The path namespace indicates which `app` the resource belongs to, and which storage backend is used `store`. `resource` is a unique identifier within the `app` namespace.

- **Collections** take `(client, path, [options])`:
  ```javascript
  const slidesMap = new SharedMap(client, "/app/items/slides");
  const tagsSet = new SharedSet(client, "/app/items/tags");
  ```
- **Variables** add a name as last parameter, as they are managed as independently named objects within a resource `(client, path, name, [options])`:
  ```javascript
  const counter = new SharedInteger(client, "/myapp/items/vars", "counter");
  const title = new SharedString(client, "/myapp/items/vars", "title");
  ```
  
Abstractions can be created immediately after `client` initialization.

Abstractions typically have empty state in the short time before the client has obtained a working connection to the server. The abstraction will emit a change event as soon as the connection is established and the initial state from the server is delivered. 

Empty state is a legal state, though, so from the perspective of application code, abstractions are ready to use immediately.

State mutation, however, requires an open connection, and will throw Error if the connection is not open.


### Event Subscriptions

SharedState abstractions implement a common `Events` interface (`on`, `off`, `once`). A `"change"` event is emitted whenever state updates.

Passing `{ init: true }` as an option to `on("change", handler, options)` ensures an initial event is emitted immediately after subscription, ahead of subsequent change events. This immediate event carries the initial state of the abstraction.

```javascript
const handle = abstraction.on("change", (val) => {
    // Render or update application UI
}, { init: true });

// Later...
abstraction.off(handle);
```

### Variable Types

Single-value abstractions backed by server paths `(client, path, name, [options])`:

- All variables support `.get()` and `.value` for value access, and `set(value)` for mutation. 
- Typed variables are restricted to values of a given type, or `undefined`.

In addition, a few variable types define specialized methods:

- **`SharedVariable`**: Generic untyped single value (`get()`, `set(val)`).
- **`SharedBoolean`**: Variable restricted to `boolean` values (`get()`, `set(bool)`, `toggle()`).
- **`SharedString`**: Variable restricted to `string` values (`get()`, `set(str)`).
- **`SharedInteger`**: Variable restricted to `integer` values (`get()`, `set(num)`, `inc(delta)`, `dec(delta)`).
- **`SharedFloat`**: Variable restricted to `floating point number` values (`get()`, `set(num)`, `inc(delta)`, `dec(delta)`).
- **`SharedRecord`**: Variable restricted to `{}` values (`get()`, `set(obj)`).
- **`SharedArray`**: Variable restricted to `[]` values (`get()`, `set(arr)`).

### Map and Set Collections

Collection abstractions backed by server paths `(client, path, [options])`:

- **`SharedMap`**: Key-value map emulating standard JavaScript `Map`:
  - `set(key, value)`, `get(key)`, `has(key)`, `delete(key)`, `clear()`
  - `size`, `keys()`, `values()`, `entries()`, `forEach(cb)`
- **`SharedSet`**: Set of unique elements:
  - `add(value)`, `has(value)`, `delete(value)`, `clear()`, `size`

---

## 5. Advanced Material

### Connection Management

Regular usage of SharedState programming abstractions does not require specific attention to the connection. However, if an application needs to inspect connection status or react to lifecycle changes, `client.connection` provides state tracking and event hooks.

```javascript
// 1. Inspect current connection state
if (client.connection.state === ConnectionState.CONNECTED) {
    console.log("Client is connected to server");
}
// 2. Wait for connection.state to become CONNECTED
await client.connection.connectedPromise();
```

#### `ConnectionState` Enum Values

- **`ConnectionState.DISCONNECTED`** (`"disconnected"`): Closed state, pending initial connect or next reconnect.
- **`ConnectionState.CONNECTING`** (`"connecting"`): WebSocket connect or handshake in progress.
- **`ConnectionState.CONNECTED`** (`"connected"`): Open WebSocket connection.
- **`ConnectionState.TERMINATED`** (`"terminated"`): Closed after max retries, will not reconnect automatically (page reload required).


### Server Clock Synchronization

Access server-synchronized time and latency measurements:

```javascript
// Current estimated server UTC time (seconds since Unix epoch)
const serverTime = client.serverclock.now();

// Estimated round-trip latency (seconds)
const latency = client.serverclock.rtt;

// Estimated clock skew between client and server (seconds)
const skew = client.serverclock.skew;
```
