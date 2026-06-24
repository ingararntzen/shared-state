---
name: shared-state
description: Guidelines and examples for using the JavaScript client library of the Shared State real-time sharing service.
---

# Shared State JS Client Guide

This guide covers the usage of the JavaScript client bindings for the Shared State real-time data sharing service.

## Installation and Setup

The JavaScript client can be imported either as an ES6 module or via a global variable.

### ES6 Module Import

```html
<script type="module">
    import { SharedStateClient } from "./libs/sharedstate.es.js";
    const client = new SharedStateClient("ws://localhost:9000", {
        debug: true,  // Optional: enable console log debugging
        retries: 5    // Optional: max reconnection attempts (default: 4)
    });
</script>
```

### Global Variable Import (IIFE)

```html
<script src="./libs/sharedstate.iife.js"></script>
<script>
    const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
```

### Waiting for Connection

You can wait for the connection to be successfully established using the `connectedPromise()` method:

```javascript
client.connectedPromise().then(() => {
    console.log("Client connected to Shared State server!");
});
```

---

## Proxy Collections

Proxy Collections manage local collections serving as proxies to server-side collections. They automatically synchronize with server-side changes and support update actions.

### Acquiring and Releasing Collections

```javascript
// Acquire a collection
const coll = client.acquire_collection("/myapp/items/mycollection");

// Release a collection (stops synchronizing and updates)
client.release("/myapp/items/mycollection");
```

### Accessing Items

Proxy Collections provide the following methods to query local items:

```javascript
// Return a single item, given id
const item = coll.get_item(id);

// Return true if the collection contains an item with id
const ok = coll.has_item(id);

// Return list of all items in the collection
const items = coll.get_items();

// Return the size (number of items) in the collection
const size = coll.size;
```

### Updates

Modifications are performed as batch operations using `update_items(changes)`:

```javascript
coll.update_items({
    remove: ["id1", "id2"], // List of IDs to remove (performed first)
    insert: [{ id: "id3", state: "value" }], // List of items to insert or replace
    reset: false // If true, removes all pre-existing items before inserting
});
```

* `remove`: Default is `[]`.
* `insert`: Default is `[]`. If items do not have an `id` property, a random string ID is auto-generated.
* `reset`: Default is `false`.

### Callback Subscriptions

Callbacks are notified on membership and property changes:

```javascript
const handle = coll.add_callback((diffs) => {
    for (const diff of diffs) {
        console.log(`Item ID: ${diff.id}`);
        console.log(`New value:`, diff.new);
        console.log(`Old value:`, diff.old);
    }
});

// Unsubscribe
coll.remove_callback(handle);
```

#### Diff Types

| Event Type | Condition |
|---|---|
| **INSERT** | `diff.new` is defined, `diff.old` is `undefined` |
| **REPLACE** | Both `diff.new` and `diff.old` are defined |
| **DELETE** | `diff.new` is `undefined`, `diff.old` is defined |

---

## Proxy Objects

Proxy Objects manage a set of items (an array) stored within a single server-side item on the service.

The ProxyObject interface implements the same querying methods as ProxyCollections:

* `set_items(items)`: Sets the entire array of items. Returns a Promise resolved after the set operation has taken effect on the server.
* `get_items()`: Returns all items in the array.
* `get_item(id)`: Returns a single item from the array, given its ID.
* `has_item(id)`: Returns true if an item with the given ID exists in the array.

### Acquiring a Proxy Object

```javascript
// acquire_object(path, objectId, options)
const myobj = client.acquire_object("/myapp/items/mycollection", "myobj");
```

### Accessing and Modifying the Object

```javascript
// set items
myobj.set_items([
    {id: "sub_id_1", state: "foo"},
    {id: "sub_id_2", state: "bar"}
]);

// get all items
const items = myobj.get_items();

// get a single item by id
const item = myobj.get_item("sub_id_1");
```

### Callbacks for Proxy Objects

Like ProxyCollections, changes are reported through callback subscriptions.

```javascript
const handle = myobj.add_callback((diff) => {
    console.log("Object changed from", diff.old, "to", diff.new);
});

// Unsubscribe
myobj.remove_callback(handle);
```

---

## Collection Viewer Utility

The built-in `CollectionViewer` class binds a Proxy Collection directly to a DOM container.

```javascript
import { CollectionViewer } from "./libs/sharedstate.es.js";

const container = document.getElementById("my-list-container");
const viewer = new CollectionViewer(coll, container, {
    delete: true, // Enables click-to-delete behavior
    toString: (item) => `<div>${item.id}: ${JSON.stringify(item.state)}</div>`
});
```

---

## Server Clock Synchronization

The SharedState client includes a built-in mechanism to estimate the server's clock and synchronize time. The client automatically sends ping requests to keep a sliding window of time samples.

### Accessing the Synchronized Clock

The synchronized clock is accessed via the `clock` property on the `SharedStateClient` instance:

```javascript
// Get the current estimated server epoch time (in seconds)
const serverTime = client.clock.now();

// Get the estimated transit delay (one-way round-trip latency in seconds)
const transitTime = client.clock.trans;

// Get the estimated skew between the local client and the server clock (in seconds)
const skew = client.clock.skew;
```

### Pausing and Resuming Synchronization

By default, the clock starts synchronizing when the connection is established. You can manually pause, resume, or restart the background pinging/sampling mechanism by interacting with the `pinger` object exposed by the clock:

```javascript
// Pause background pinging/sampling
client.clock.pinger.pause();

// Resume background pinging/sampling
client.clock.pinger.resume();

// Restart the background pinging/sampling sequence
client.clock.pinger.restart();
```
