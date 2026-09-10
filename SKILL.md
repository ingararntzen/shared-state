---
name: shared-state
description: Guidelines and code examples for using the JavaScript client library of the Shared State real-time sharing service.
---

# Shared State JS Client Guide

This guide provides context, API definitions, and code examples for working with the JavaScript client library of the SharedState real-time data sharing service.

## Client Setup and Connection

The JavaScript client can be imported either as an ES module or via global variable script import (IIFE).

### ES Module Import

```html
<script type="module">
    import { SharedStateClient, SharedMap, SharedSet, SharedVariable, SharedInteger, SharedArray } from "./libs/sharedstate.es.js";

    const client = new SharedStateClient("ws://localhost:9000", {
        debug: true,  // Optional: enable console log debugging
        retries: 5    // Optional: max reconnection attempts (default: 4)
    });
</script>
```

### Global Script Import (IIFE)

```html
<script src="./libs/sharedstate.iife.js"></script>
<script>
    const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
```

### Connection Management

Use `client.connection` to inspect connection state or wait for a successful WebSocket connection:

```javascript
// Wait for initial connection to complete
await client.connection.connectedPromise();
console.log("Client connected to SharedState server!");

// Connection lifecycle event callbacks
client.connection.on_connect = () => console.log("Connected");
client.connection.on_disconnect = () => console.log("Disconnected");
```

---

## High-Level Data Abstractions

SharedState provides high-level reactive data structures that synchronize automatically with server-side collection paths.

### SharedMap

Manages key-value item collections backed by a server path:

```javascript
import { SharedMap } from "./libs/sharedstate.es.js";

// Instantiate SharedMap for a given path
const map = new SharedMap(client, "/myapp/items/slides");

// Wait until initial server sync finishes
await map.ready();

// Map operations
map.set("slide1", { title: "Introduction", page: 1 });
const slide = map.get("slide1");
const exists = map.has("slide1");
const count = map.size;

// React to changes
map.add_callback((diffs) => {
    for (const diff of diffs) {
        console.log(`Changed key: ${diff.id}, New:`, diff.new, `Old:`, diff.old);
    }
});

// Clean up when finished
map.destroy();
```

### SharedVariable & SharedInteger

Represent single reactive values stored at a specific item resource path:

```javascript
import { SharedVariable, SharedInteger } from "./libs/sharedstate.es.js";

const titleVar = new SharedVariable(client, "/myapp/mitems/title");
await titleVar.ready();

// Get / Set variable value
titleVar.set("My Presentation");
console.log(titleVar.get()); // "My Presentation"

// Reactive listener
titleVar.add_callback((val) => {
    console.log("Title updated to:", val);
});

// Integer counter with atomic increment operations
const counter = new SharedInteger(client, "/myapp/mitems/likes");
await counter.ready();

counter.increment(); // Increments value by 1
counter.decrement(); // Decrements value by 1
```

---

## Low-Level Collection Resources

For direct manipulation of raw collection items and batch update operations:

### Acquiring Collection Resources

```javascript
// Acquire a collection resource
const coll = client.get_collection_resource("adm", "/myapp/items/mycollection");

// Query local items
const items = coll.get_items();
const item = coll.get_item("item123");
const exists = coll.has_item("item123");

// Perform batch updates
coll.update_items({
    remove: ["old_id"],                           // List of IDs to remove
    insert: [{ id: "item123", status: "active" }], // Items to insert/replace
    reset: false                                   // Set true to clear all prior items
});

// Subscribe to item collection changes
const callbackHandle = coll.add_callback((diffs) => {
    for (const diff of diffs) {
        if (diff.old === undefined && diff.new !== undefined) {
            console.log("Item inserted:", diff.id);
        } else if (diff.old !== undefined && diff.new !== undefined) {
            console.log("Item replaced:", diff.id);
        } else if (diff.old !== undefined && diff.new === undefined) {
            console.log("Item deleted:", diff.id);
        }
    }
});

// Remove callback when finished
coll.remove_callback(callbackHandle);
```

---

## Server Clock Synchronization

The client maintains high-precision server clock estimation with latency calculation:

```javascript
// Get estimated current server UTC time in seconds since epoch
const serverTime = client.serverclock.now();

// One-way transit latency in seconds
const latency = client.serverclock.trans;

// Estimated clock skew between client and server in seconds
const skew = client.serverclock.skew;
```
