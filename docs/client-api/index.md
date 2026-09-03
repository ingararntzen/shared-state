# JavaScript Client API Reference

The `sharedstate` JavaScript library allows browser applications to connect to the Python SharedState server, subscribe to resource paths, and instantiate synchronous local proxy collections.

## Installation & Imports

### ES6 Module Import
```javascript
import { SharedStateClient } from "./libs/sharedstate.es.js";

const client = new SharedStateClient("ws://localhost:9000");
```

### Global Script Include (IIFE)
```html
<script src="./libs/sharedstate.iife.js"></script>
<script>
  const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
```

---

## Core Client Classes

* **`SharedStateClient`**: Manages WebSocket connection, subscription multiplexing, request/reply tunneling, and clock sync.
* **`ItemProvider`**: Synchronized local map of items for a resource path with change callbacks.
* **`ProxyObject`**: Item-level proxy wrapper for managing array states within a single collection item.
* **`ServerClock`**: Time offset estimator providing synchronized server network time.

---

## Basic Usage Example

```javascript
// Connect to server
const client = new SharedStateClient("ws://localhost:9000");

// Acquire state provider for path /myapp/items/todo
const todos = client.provider("/myapp/items/todo");

// Listen for updates
todos.add_callback((diffs) => {
  diffs.forEach(diff => {
    console.log(`Item ${diff.id} updated:`, diff.new);
  });
});

// Insert new item
todos.update_items({
  insert: [{ id: "task-1", state: { title: "Document SharedState", done: false } }]
});
```
