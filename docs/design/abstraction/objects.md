[ItemCollection]: /design/representation/item_collection
[ItemCollections]: /design/representation/item_collection
[ItemProvider]: /design/representation/item_provider
[ItemProviders]: /design/representation/item_provider
[Variables]: /design/abstraction/objects#variables
[Collections]: /design/abstraction/objects#collections
[Path]: /design/representation/item_collection#path
[Item]: /design/representation/item_collection#item

# Shared Objects Design


> SharedState facilitates state sharing through a family of application objects.


- Application objects offer familiar and easy-to-use programming abstractions to developers, while hiding the complexities of state management and synchronization.

- An application object is a facade object, whose state is backed by a client-side [ItemProvider], which in turn is backed by a server-side [ItemCollection].



---
## Variables

[Variables] are abstractions that represent a single value, and support methods for value access and assignment, i.e., `get()` and `set(value)`.

[Variables] are bound to a single [Item] within an [ItemProvider]. As such, they are defined by a `(path, name)` tuple, where the `path` identifies the [ItemProvider]'s [Path] and `name` identifies an [Item] within that [ItemProvider]. 

::: tip Note
[Variables] can **not** be bound to a [Path] which is already bound to by a [Collection]. Note however, that this protection is only enforced within the scope of a single client.  
:::


### Typed Variables


- Typed variables are restricted to a single type, or `undefined`. 
- The framework supports `SharedBoolean`, `SharedInteger`, `SharedFloat`, `SharedString`, `SharedRecord`, and `SharedArray`. 
- Type-checking is performed on assignment, throwing `TypeError` if the new value is not the correct type.
- Special methods `inc(delta)` and `dec(delta)` are defined for `SharedInteger` and `SharedFloat`.

The online nature of shared variables presents a particular challenge with respect to type safety: There is no guarantee that type restrictions will be respected by other clients. For this reason, SharedState adopts an optimistic approach, where application objects fall back on default values, whenever the underlying state is illegal.

Options `allowUndefined`, `defaultValue`, and `initialValue` regulate this functionality.

- **defaultValue**: The default behavior of typed variables is to fall back on type defaults, i.e. `false`, `0`, `0.0`, `""`, `{}`, `[]`. This behavior can be overridden by specifying an alternative value for the `defaultValue` option. If not provided, `defaultValue` defaults to `undefined`. 

- **initialValue**: This option specifies an `initialValue` for the variable. This value will only apply **initially**, i.e. until a **legal** value has been received from the underlying `ItemProvider`. This may be used to provide a sensible default value for the variable immediately, as opposed to waiting for connection and initialization from the server. `initialValue` has precedence over `defaultValue`, which in turn has precedence over type defaults. If not provided, `initialValue` defaults to `undefined`. 

- **allowUndefined**: This option determines whether `undefined` is counted as a **legal** value for the variable. If not provided, `allowUndefined` defaults to `true`.



### Untyped Variables

`SharedVariable` is an untyped variable, supporting any value, including `undefined`.  

---
## Collections

[Collections] are abstractions that represent a collection of elements. They support methods for access to elements within the collections, and methods which alter the collection, by inserting, replacing, and deleting elements. 

[Collections] are bound to a single [ItemProvider] and identified by a [Path].

::: tip Note
[Collections] can **not** be bound to a [Path] which is already bound to by a [Variable]. Note however, that this protection is only enforced within the scope of a single client.
:::

### Map 

`SharedMap` represents a **Key-Value Dictionary**. The interface emulates a JavaScript `Map`, and there is 1:1 correspondence between (`key`, `value`) pairs in `SharedMap` and the [Items] of the underlying [ItemProvider]. 


### Set 

`SharedSet` represents an **Unordered Set** with no duplicates. The interface emulates a JavaScript `Set`, and there is 1:1 correspondence between elements in `SharedSet` and the [Items] of the underlying [ItemProvider].

`Set` differs from `Map` in that its elements do not have keys, but rather that equality must be based on the elements themselves. Moreover, since the implementation is agnostic to the internal structure of `Set` elements, it cannot infer equality by itself. Instead, the application must provide a mechanism for determining element equality. There are two mechanisms for this:

1. **Custom Key Extractor**: Programmers can supply a custom key function (e.g. `user => user.userId`).
2. **Explicit `.id` Property**: If an element is an object containing an `.id` property, `String(elem.id)` is used.

The fallback solution is to serialize elements using canonical JSON stringification. In this approach, object keys are recursively sorted prior to JSON stringification. This guarantees that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce identical keys and evaluate as equal elements in the set. However, this approach is not efficient, and particularly so if elements are large objects.


---

## Instances of Application Objects

Application objects are created as regular class instances, bound to the SharedState client, and are immediately ready to use.

```js
const myMap = new SharedMap(client, "/myapp/store/mymap", {})
const myInt = new SharedInteger(client, "/myapp/store/myvars", "myInt", {})
```

Application objects enforce **reference equality**. This means that objects bound to the same [Path] will all refer to the exact same facade object. This is perhaps not of the greatest importance, but it ensures:

- zero extra cost if different application modules independently bind to the same `path` or `(path, name)` tuple.
- no need to share multiple object references across module boundaries (provided that the SharedState client is available across all modules).
- reference equality provides a quick check if two objects refer to the same resource.


---

## Object Access Semantics

### Queries

- State access operations such as `.get()`, `.values()`, `.keys()` or `.size()` are **local**, **synchronous** operations.

### Updates

- State update operations such as `.set()`, `.update()`, `.inc()`, `.dec()`, `.add()`, `.delete()`, `.clear()` are **local** and **synchronous** operations, in the sense that they only dispatch update requests to the server, they do not block for completion.

- The effects of an update operation are **never** visible to other queries or updates within the same microtask.

- Update requests can be invoked in rapid succession, as a way of streaming updates to the server. 

- Update operations return a Promise for **asynchronous** completion.

### Events

- Application objects implement `change` events, which are `emitted` every time their state changes. 
- Applications can observe state changes by registering an event handler. 
- Application code may register handlers immediately after the object is instantiated.


```js
render();
const render = function () {
   const current = myInt.get();
   // perform UI update  
};
myInt.on("change", render);
```

This code renders initial state, and then bind rendering to subsequent state changes.

#### Init mode

The same functionality can also be achieved more concisely by using the `{ init: true }` option for the event subscription:

```js
myInt.on("change", render, { init: true });
```

**Init mode** ensures that an initial event is delivered to the handler, immediately after subscription. 

- This pattern implies that initialization is not a special operation, but modelled as the first event.
- In larger programs this pattern may reduce code complexity and make the logic easier to reason about. 
- This pattern may also remove the need for separate logic concerning readiness of the event source, as readiness is simply modelled as the first state change.
