# Event Mechanism

All SharedState state objects (`SharedVariables`, `SharedMap`, `SharedSet`) provide decoupled event handling capabilities (`.on`, `.off`, `.once`). They emit a **`"change"`** event whenever state updates locally or over the network.

## Subscribing (`.on`)

Subscribe to state change events on any variable, map, or set.

```javascript
const handle = stateObject.on("change", (valueOrChanges, eInfo) => {
    console.log("Updated Payload:", valueOrChanges);
    console.log("Is Initial Snapshot:", eInfo.init);
});
```

### Callback Arguments
1. **`valueOrChanges`**: Event payload.
   - **For SharedVariables**: The newly updated variable value.
   - **For SharedMap & SharedSet**: A delta change object `{ insert, remove, reset }`.
2. **`eInfo`**: Event metadata object containing:
   - `src`: Source state object instance emitting the event.
   - `name`: Event name string (`"change"`).
   - `count`: Number of times this event handler has executed.
   - `init`: Boolean indicating whether this invocation is the initial state snapshot.
   - `handle`: Subscription handle object.

### Subscription Options
- **`options.init`** (`boolean`): When set to `true`, immediately delivers the current state snapshot to the callback upon subscription.

## Unsubscribing (`.off`)

Unsubscribe from event updates.

```javascript
// Option A: Unsubscribe via handle
handle.off();

// Option B: Unsubscribe by event name and callback reference
stateObject.off("change", callback);
```

## One-Time Listeners (`.once`)

Subscribe to a single state change execution.

```javascript
stateObject.once("change", (eArg, eInfo) => {
    console.log("Received first update:", eArg);
});
```
