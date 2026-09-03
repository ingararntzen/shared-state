[ItemCollection]: /design/representation/item_collection
[ItemCollections]: /design/representation/item_collection
[ItemProvider]: /design/representation/item_provider
[ItemProviders]: /design/representation/item_provider
[Variables]: /design/abstraction/objects#variables
[Collections]: /design/abstraction/objects#collections
[Path]: /design/representation/item_collection#path
[Item]: /design/representation/item_collection#item

# Application Objects


> SharedState facilitates state sharing through a family of application objects.


- Application objects offering familiar and easy to use programming abstractions to developers, while hiding the complexities of state management and synchronization.

- An application object is a facade object, whose state is backed by a client-side [ItemProvider], which in turn is backed by a server-side [ItemCollection].



---
## Variables

[Variables] are abstractions that represent a single value, and support methods for value access and assignment, i.e., `get()` and `set(value)`.

[Variables] are bound to a single [Item] within an [ItemProvider]. As such, they are defined by a `(path, id)` tuple, where the `path` identifies the [ItemProvider]'s [Path] and `id` identifies an [Item] within that [ItemProvider]. 

::: tip Note
[Variables] can **not** be bound to a [Path] which is already bound to by a [Collection]. Note however, that this protection is only enforced within the scope of a single client.  
:::


### Typed Variables


- Typed variables are restricted to a single type, or `undefined`. 
- The framework supports `SharedBoolean`, `SharedInteger`, `SharedFloat`, `SharedString`, `SharedObject`, and `SharedArray`. 
- Type-checking is performed on assignment, throwing `TypeError` if the new value is not the correct type.
- Special methods `inc(delta)` and `dec(delta)` are defined for `SharedInteger` and `SharedFloat`.

The online nature of shared variables presents a particular challenge with respect to type safety: There is no guarantee that type restrictions will be respected by other clients. For this reason, SharedState adopts an optimistic approach, where application objects fall back on default values, whenever the underlying state is illegal.

Options `allowUndefined`, `defaultValue`, and `initialValue` regulate this functionality.

- **defaultValue**: The default behavior of typed variables is to fall back on type defaults, i.e. `false`, `0`, `0.0 `, `""`, `{}`, `[]`. This behavior can be overridden by specifying an alternative value for the `defaultValue` option. If not provided, `defaultValue` defaults to `undefined`. 

- **initialValue**: This option specifies an `initialValue` for the variable. This value will only apply **initially**, i.e. until a **legal** value has been received from the underlying `ItemProvider`. This may be used to provide a sensible default value for the variable immediately, as opposed to waiting for connection and initialization from the server. `initialValue` has precedence over `defaultValue`, which in turn has precedence over type defaults. If not provided, `initialValue` defaults to `undefined`. 

- **allowUndefined**: This option determines whether `undefined` is counted as a **legal** value for the variable. If not provided, `allowUndefined` defaults to `true`.



### UnTyped Variables

`SharedVariable` is an untyped variable, supporting any value, including `undefined`.  

---
## Collections

[Collections] are abstractions that represent a collection of elements. They support methods for access to elements within the collections, and methods which alters the collection, by inserting, replacing, and deleting elements. 

[Collections] are bound to a single [ItemProvider] and identified by a [Path].

::: tip Note
[Collections] can **not** be bound to a [Path] which is already bound to by a [Variable]. Note however, that this protection is only enforced within the scope of a single client.
:::

### Map (Key-Value Dictionary)

`SharedMap` implements the interface of a JavaScript `Map`. There is 1:1 correspondence between (`key`, `value`) pairs in `SharedMap` and the [Items] of the underlying [ItemProvider]. 


### Set (Unordered Structural Set)

`SharedSet` implements the interface of a JavaScript `Set`. There is 1:1 correspondence between elements in `SharedSet` and the [Items] of the underlying [ItemProvider]. 

`Set` differs from `Map` in that its elements do not have a key, but rather that equality must be based on elements themselves. Moreover, since the implementation is agnostic to the internal structure of `Set` elements, it cannot infer equality by itself. Instead, the application must provide a mechanism for determining element equality. There are two mechanisms for this:

1. **Custom Key Extractor**: Programmers can supply a custom key function (e.g. `user => user.userId`).
2. **Explicit `.id` Property**: If an element is an object containing an `.id` property, `String(elem.id)` is used.

The fallback solution is to serialize elements using canonical JSON stringification. In this approach, object keys are recursively sorted prior to JSON stringification. This guarantees that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce identical keys and evaluate as equal elements in the set. However this approach is not efficient, and particularly so if elements are large objects.




---

## Reference Equality & Identity Caching

All Application Objects enforce **reference equality**: instantiating or querying an object bound to the exact same path or `(path, name)` tuple returns the **same object instance in memory** (`objA === objB`).

- **Unified UI State**: Multiple UI components binding to the same path or variable share the exact same object reference, preventing divergent local states or race conditions.
- **Provider Sharing**: A single `ItemProvider` handles underlying WebSocket subscriptions, version tracking, and delta distribution for all consumers of that path.

---

## Event-Driven Reactivity & Streaming

Application Objects provide non-blocking local reads backed by real-time push synchronization.

- **Non-blocking Local Reads**: Querying state (`.value`, `.get()`, `.values()`) is an instant local memory lookup.
- **Direct Change Streaming**: Collections emit change events matching native client-side delta payloads (`{ insert: Map, remove: Set, reset: Boolean, version: Number }`).
- **State Hydration (`{ init: true }`)**: Listening with `{ init: true }` triggers initial state delivery immediately before streaming live delta updates.
