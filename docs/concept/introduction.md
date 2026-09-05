[ItemCollection]: /design/representation/item_collection#itemcollection
[ItemCollections]: /design/representation/item_collection#itemcollection

# Introduction

> SharedState supports online state sharing at the level of individual application variables and collection types.

Traditional web development is typically split between two concerns: developers express interface functionality synchronously through the manipulation of in-memory variables, and then switch to an asynchronous execution model for managing online-hosted data sources.

In **single-process programming**, application-specific logic is defined through assignment and mutation of general-purpose programming abstractions, such as:

- **Variable types**: `boolean`, `integer`, `string`, `float`.
- **Collection types**: `List`, `Map`, `Set`, `Tree`, `Graph`.

The core philosophy of SharedState is to adapt this model to the online world. This means that programming is still based on similar abstractions, but, importantly, that the abstractions live externally to the process, and may therefore be shared across multiple processes.

This idea immediately inspires a new set of programming abstractions:
- **Variable types**: `SharedBoolean`, `SharedInteger`, `SharedString`, `SharedFloat`.
- **Collection types**: `SharedList`, `SharedMap`, `SharedSet`, `SharedTree`, `SharedGraph`.

These new abstractions closely mirror their single-process counterparts, but with the important difference that they are proxies to remote resources, and that their state mutation is therefore principally an **asynchronous** operation.

---

## Perspective

This model offers two key takeaways with respect to programming abstractions and application architectures:

- **Familiar Concepts, Extended Scope**: Application development remains intuitive and expressive, as it is defined in terms of familiar programming abstractions. Crucially, though, since these abstractions are re-interpreted as online resources, their scope is extended, from local to global. Following this transformation, access semantics change slightly, as state updates are no longer synchronous operations.

- **Independent Resources vs. Monolithic Datamodel**: This represents a shift away from traditional web architectures, where online state management is typically organized around a single data model, database, or service type. SharedState, in contrast, encourages a model where online state management is addressed at a lower level, within individual variables, collections, and data-structures. Such a fine-grained approach to state management provides more flexibility, as it allows sharing scope and access restrictions to be specified on a per-resource basis. Moreover, this model implies that application-specific datamodels can be formed on the client-side to a larger degree, through the composition of simpler, generic resources. Furthermore, it inspires a class of backend services specializing in simple, general-purpose resources.


---

## Objective

The objective of SharedState is to facilitate **online sharing of application state — at the level of individual variables and collections**.

---

## Applicability

Asking what shared variables and shared collections can be used for is very much like asking what `variables`, `Lists`, and `Maps` can be used for in single-process programming. Anything, really!

SharedState, importantly, further **extends the scope** of such programming constructs, imbuing them with built-in support for **shared usage** across multiple devices and/or client sessions.

For inspiration, here are some common scenarios that are trivially addressed by SharedState:

- using SharedMap to back a live dataset, recorded by one device and visualized by another.
- using SharedList to back a playlist, a feed, an activity log, or active data layers in a map. 
- using SharedString to manage the ID of the currently selected item in a SharedList, or who holds the presenter role in a slideshow presentation.
- using SharedFloat to represent offset in a media player, or scroll position in a document.
- using SharedObject to hold `longitude`, `latitude`, and `extent` of a map viewer.
- using SharedMap to hold live layout configuration options for a multi-screen presentation system.
- using SharedSet to hold active client sessions.
- using SharedInteger to control slide show progression.
- using SharedBoolean to toggle the mic or camera on/off across participants in a call.
- using SharedFloat to report performance stats from clients, such as network latency, CPU usage, or buffer capacity for live data streaming.


In short, developers can exploit SharedState for both resource sharing and distributed application control.

- **Resource management**: SharedState may be exploited as a real-time hosting service for a variety of dynamic application data sources, from small configuration options to large datasets.
- **Runtime control**: SharedState may also be exploited as a mechanism for distributed application control, enabling any aspect of application behavior to be subject to real-time, distributed adjustments.



---

## Design Principles

The SharedState approach is based on the following design principles:

- **Fine-grained State Management**: State sharing is implemented at the level of general-purpose programming abstractions, such as `variables`, `lists`, `maps`, etc. This creates flexibility in application design, as it allows different types of state to be backed by different abstractions. Moreover, the approach allows sharing scopes and access restrictions to be defined on a per-resource basis, as opposed to once for a monolithic data model.

- **Client-side State Replication**: SharedState resources are hosted online, but mirrored by clients as local proxy objects. This implies that queries are local operations with zero delay. Updates, by contrast, are processed by the server, and will therefore imply a network delay. However, this update delay is effectively masked, as updates are applied optimistically at the client, before being dispatched to the server, while reconciling consistency issues as they occur.

- **Reactive Programming**: The reactive programming pattern is particularly designed for consistent sharing of dynamic state. The pattern decouples UI rendering from state management. UI rendering is modeled as a pure function of shared state, without synchronous access to state mutation. Moreover, rendering logic is driven by state changes, regardless of who requested the state change. This stands in contrast to the classical request-reply pattern, where application logic is driven primarily by request completion. SharedState encourages this reactive pattern, allowing application logic, including UI rendering, to be driven by state changes in shared programming abstractions. SharedState also satisfies this pattern by insisting that the effects of update requests are not made visible until the next microtask.

- **Online-first Semantics**: SharedState provides a uniform abstraction for application resources, whether hosted online or backed by local storage. A uniform abstraction ensures that local and remote resources can be used interchangeably. For instance, this allows application components to be developed within a single-process environment, and subsequently deployed in a distributed context, without requiring any changes. Moreover, remote resource semantics generalize well to local state, whereas the opposite is not the case. In remote semantics, local objects are simply objects with a smaller update delay. For this reason, SharedState treats all resources as remote resources.

- **Domain-Agnostic Server**: SharedState faces a fundamental tension in distributed systems design: While server infrastructure must remain simple and lightweight to ensure high performance and scalability, developers require rich and diverse abstractions tailored to different application contexts and interaction patterns. SharedState balances these demands by organizing replication around a single, domain-agnostic resource abstraction on the server [ItemCollection], while also ensuring that this low-level abstraction can be specialized into more advanced abstractions by client-side libraries (e.g., `SharedList`, `SharedTree`, `SharedGraph`). This keeps the server generic, fast, and easy to maintain and optimize, while simultaneously enabling the SharedState framework to be extended with new, specialized abstractions, without requiring changes to the server.


---
## Related Concepts


