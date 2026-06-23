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
    const client = new SharedStateClient("ws://localhost:9000");
</script>
```

### Global Variable Import (IIFE)

```html
<script src="./libs/sharedstate.iife.js"></script>
<script>
    const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
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

Modifications are performed as batch operations using `update(changes)`:

```javascript
coll.update({
    remove: ["id1", "id2"], // List of IDs to remove (performed first)
    insert: [{ id: "id3", data: "value" }], // List of items to insert or replace
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

Proxy Objects allow developers to interact with a single shared object using simple `set()` and `get()` methods. A Proxy Object internally maps to a single item within a Proxy Collection.

### Acquiring a Proxy Object

```javascript
// acquire_object(path, objectId, options)
const myobj = client.acquire_object("/myapp/items/mycollection", "myobj");
```

### Accessing and Modifying the Object

```javascript
// Get the current value
const value = myobj.get();

// Set the value (returns a Promise resolved after server round-trip)
myobj.set({ someKey: "someValue" }).then(() => {
    console.log("Object successfully updated on server");
});
```

### Callbacks for Proxy Objects

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
    toString: (item) => `<div>${item.id}: ${JSON.stringify(item.data)}</div>`
});
```
