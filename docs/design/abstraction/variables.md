# Variables

> Variables are programming abstractions representing a single value or object. 


---

## Path Structure

A Variable binds to a **4-segment path**:

```
/app_name/store_name/resource_name/item_id
```

- Segments 1–3 (`/app/store/res`) identify the underlying Item Collection.
- Segment 4 (`item_id`) identifies the specific item inside the collection.

---

## Typed Variable Classes

SharedState provides dedicated typed variable classes extending `Variable`:

| Type Class | Type Name in `load()` | Default Fallback Value (`defaultValue`) |
| :--- | :--- | :--- |
| `Variable` | `"Variable"` | `undefined` |
| `SharedBool` | `"Boolean"`, `"Bool"` | `false` |
| `SharedInteger` | `"Integer"` | `0` |
| `SharedFloat` | `"Float"` | `0.0` |
| `SharedString` | `"String"` | `""` |
| `SharedObject` | `"Object"` | `{}` |
| `SharedArray` | `"Array"` | `[]` |

---

## Value Resolution & Lifecycle

### `defaultValue`
If the underlying server state is missing (`undefined`), `null`, or illegal for the type (e.g. string `"hello"` stored in a `SharedInteger`), reading `.value` safely returns `defaultValue`.

### `initialValue`
An `initialValue` can be configured via `client.load()` options:

```javascript
const { isReady, score } = client.load({
    isReady: { type: "Boolean", path: "/app/store/vars/ready", options: { initialValue: true } },
    score: { type: "Integer", path: "/app/store/vars/score", options: { initialValue: 100 } }
});
```

- **Server-Driven Lifecycle**: `initialValue` takes precedence over `defaultValue` **strictly until valid state arrives from the server** over WebSocket sync.
- Once a valid value is received from the server, `_hasValidValue` becomes `true`, deactivating `initialValue`.

---

## Reactive Events & Provider Access

### Change Events (`eventify`)
Layer 2 variables are decorated with `eventify`, emitting `"change"` events when their value updates:

```javascript
counter.on("change", (newVal) => {
    console.log("Counter updated:", newVal);
}, { init: true });
```

### Provider Getter
Every Variable instance exposes a `.provider` getter returning a reference to its underlying `ProxyCollection`:

```javascript
console.log(counter.provider); // ProxyCollection instance
```
