# The SharedState Paradigm

> - SharedState enables online state sharing at the level of individual application variables and resources.


## Introduction

Traditional web development is typically split between two concerns: developers express interface functionality synchronously through the programmatic manipulation of in-memory variables, and then switch to an asynchronous execution model for managing online-hosted resources.

## Objective

The objective of SharedState is **not to remove this distinction**, but to facilitate **online shareing of application state -- at the granularity of individual variables, objects, and collections**.

## Approach

The SharedState paragidm is characterized by the following design objectives:

- **Level of Granularity**: State sharing is implemented at the level of individual application resources, such as `variables`, `objects`, and `collections`, as opposed to larger, predefined data models. This creates flexibility in application design, as it allows sharing scopes and access restrictions to be defined on a per-resource basis.

- **Client-Side State Replication**: SharedState resources are hosted as online resources, but **mirrored** locally on clients, where they are made available as `proxies` to server-hosted resources. Querying shared state targets the the local `proxy`, implying that **queries** are synchronous operations with zero latency. State changes are processed at the server, implying that **updates** are asynchronous operations with a non-negligible network delay.

- **Online-first model**: SharedState provides a uniform abstraction for application resources, whether hosted locally or online. However, rather than hiding the distibuted nature of resources, SharedState instead adopts an **online-first** model where all resources are considered online, and where the local resources are different only in the sense that they have smaller update latency.   

- **Reactive Programming**: SharedState encourages a reactive programming pattern, thus moving away from traditional request-reply interaction patterns to a model where application code reacts to changes in shared state.

- **Dumb server Appraoch**: SharedState is designed to be generic and domain-agnostic. It addresses state sharing through generic **insert**, **replace**, **delete** primitives targeting a common resource representation, allowing more specialzed application entities to be realized on top of this basic abstraction, such as `list`, `set`, `map`, `tree`.

- **Application-Defined Representation**: SharedState is only concerned with state sharing and remains agnostic to the internal representation of resources intended for sharing. This allows applications to freely define the internal representation of resources without necassarily relying fixed server-side schema definitions or server-side support for specialized state mutation logic






