[ItemCollection]: /design/representation/item_collection#itemcollection
[ItemCollections]: /design/representation/item_collection#itemcollection

# Introduction

> SharedState supports online state sharing at the level of variables and collection types.

Traditional web development is typically split between two concerns: developers express interface functionality synchronously through the manipulation of in-memory variables, and then switch to an asynchronous execution model for managing online data sources.

In **single-process programming**, application-specific logic is defined through assignment and mutation of general-purpose programming abstractions, such as:

- **Variable types**: `boolean`, `integer`, `string`, `float`.
- **Collection types**: `List`, `Map`, `Set`, `Tree`, `Graph`.

The core philosophy of SharedState is to adapt this model to the online world. This means that programming is still based on similar abstractions, but, crucially, that their underlying **state** may be hosted **online** and shared across multiple processes.

This idea immediately inspires a new set of programming abstractions:
- **Variable types**: `SharedBoolean`, `SharedInteger`, `SharedString`, `SharedFloat`.
- **Collection types**: `SharedList`, `SharedMap`, `SharedSet`, `SharedTree`, `SharedGraph`.

These abstractions closely resemble their single-process counterparts, but with the key difference that they are **proxies to external resources**, and that their state mutation is therefore principally an **asynchronous** operation.

---

## Perspective

This model offers two immediate takeaways with respect to programming abstractions and application architectures:

- **Familiar Concepts, Extended Scope**: As new concepts mimic established programming abstractions, the overall programming model remains largely unchanged. However, by re-interpreting programming abstractions as online resources, their scope is significantly extended.

- **Independent Resources vs. Monolithic Data Models**: By addressing state-sharing at the level of individual programming abstractions, this represents a shift away from traditional web architectures, where state management is typically organized around a single monolithic data model, database, or service type. Such a fine-grained approach to state management provides more flexibility, as it allows sharing scope and access restrictions to be specified on a per-resource basis. Moreover, the model implies that application-specific data models can be synthesized on the client-side, to a larger degree, through the runtime composition of many small, independent resources. This, in turn, may inspire backend services specializing in the hosting of such small, general-purpose resources.


---

## Objective

> The objective of SharedState is to facilitate online sharing of application state — as a built-in capability of generic programming abstractions, such as variables, collections, and generic data-structures.

---

## Applicability

Asking what shared variables and shared collections can be used for is very much like asking what `variables`, `Lists`, and `Maps` can be used for in single-process programming. Anything, really!

SharedState, importantly, further **extends the scope** of such programming constructs, imbuing them with built-in support for **shared usage** across multiple devices and/or client sessions.

For inspiration, these are common scenarios trivially addressed by SharedState:


::: tip Using ...
- `SharedMap` to back a live dataset, recorded by one device and visualized by another.
- `SharedList` to back a playlist, a feed, an activity log, or active data layers in a map. 
- `SharedString` to manage the ID of the currently selected item in a `SharedList`, or who holds the presenter role in a slideshow presentation.
- `SharedFloat` to represent offset in a media player, or scroll position in a document.
- `SharedObject` to hold longitude, latitude, and extent of a map viewer.
- `SharedMap` to hold live layout configuration options for a multi-screen presentation system.
- `SharedSet` to hold active client sessions.
- `SharedInteger` to control slide show progression.
- `SharedBoolean` to toggle the mic or camera on/off across participants in a call.
- `SharedFloat` to report performance stats from clients, such as network latency, CPU usage, or buffer capacity for live data streaming.
:::

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

To understand the practical value of the SharedState approach, it is useful to position its programming model relative to existing real-time technologies:

- **Real-Time Databases (e.g., Firebase, Supabase, Convex)**: Real-time databases organize state around structured documents or database tables in order to facilitate indexing and search. SharedState, by contrast, targets sharing of general-purpose programming abstractions, such as variables (`number`, `string`), collections (`Set`, `Map`), and data structures (`tree`, `graph`).

::: tip Why this matters
SharedState focuses on **small** resources. This makes it possible to replicate state at the client-side, and to resolve queries and state changes locally. The same trick, however, is less practical for real-time databases, as they are designed for **larger** datasets where operations must be evaluated by the database server. SharedState is therefore particularly suited for real-time sharing of lightweight datasets and dynamic control state, and it is also practical in use, as it eliminates the need to transform between database schema and application objects.
:::

- **Event Streaming & Pub/Sub (e.g., Redis Pub/Sub, Apache Kafka)**: These mechanisms typically function as message overlays, brokering **streams** of transient events between producers and consumers. Upon joining a channel, consumers might need to resolve the current state of the channel without waiting for the next event. If so, this is typically resolved through a separate mechanism, such as a REST API to an event log or cache. SharedState models **state** — not **stream** — and consequently provides both current state and change notifications as integral parts of the same mechanism.

::: tip Why this matters
**Stream** and **state** are not merely alternative concepts; they represent different levels of abstraction. SharedState eliminates the need to manually transform event formats into application objects, and also handles consistency issues that may arise when current state and event notifications are delivered through separate mechanisms. This ensures that SharedState is practical in use and a natural fit for reactive programming, where UI rendering is modeled as a pure function of shared state (`UI = f(State)`). Ultimately, pub/sub messaging systems are not direct alternatives to SharedState, but may serve as a useful mechanism for implementing the SharedState abstraction at scale.
:::


- **Collaborative Editing (e.g., Yjs, Automerge, ShareDB)**: Collaborative editing frameworks use specialized conflict-resolution algorithms such as Operational Transformation (OT) and Conflict-free Replicated Data Types (CRDTs) to merge concurrent edits on text sequences and document trees. The SharedState pattern, by contrast, aims to support generic programming abstractions with built-in support for collaborative state synchronization, without necessarily dictating a particular implementation.

::: tip Why this matters
This positions OT and CRDTs as alternative approaches for SharedState implementation, rather than competing patterns. For example, OT could be used to extend the current SharedState framework with new abstractions, such as `SharedText`, essentially supporting concurrent edits to a shared text string. Additionally, CRDTs could offer an alternative approach to replication altogether, replacing last-write-wins semantics with more sophisticated conflict resolution. This could enhance the user experience in highly interactive, collaborative scenarios, and potentially extend the applicability of the SharedState pattern to offline usage. Ultimately, this suggests that CRDTs and OT can become more practical in use, if made available alongside other (simpler) primitives for real-time state sharing.
:::




- **Game Engine State Sync (e.g., Photon, Unity Netcode)**: Game networking synchronizes real-time state (positions, angles, inputs) but is tightly coupled to specific game engines and binary tick-rate architectures. SharedState extracts these real-time state patterns into language-agnostic, web-native primitives.  
  *Why this matters*: It allows developers to apply high-frequency real-time state sharing across standard web applications, multi-device presentation systems, and microservices without being locked into a monolithic game engine.

