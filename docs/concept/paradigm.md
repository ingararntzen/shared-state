# SharedState Paradigm

> - SharedState supports online state sharing at the level of individual application variables and collection types.

## Introduction

Traditional web development is typically split between two concerns: developers express interface functionality synchronously through the manipulation of in-memory variables, and then switch to an asynchronous execution model for managing online-hosted data sources.

## Objective

The objective of SharedState is to facilitate **online sharing of application state — at the level of individual variables, objects, and collections**.

## Why?
Because online, multi-device applications often need to share *small things* across interfaces, such as:

- offset in a slideshow
- who has the role as presenter
- the selected item in a list
- a common playlist
- controls for a media player, an image carousel
- coordinates and zoom level for a map, and configuration of data layers
- current question in a quiz
- membership of a group
- whether a session is private or collaborative
- scroll position of a document
- and much more..

All application-specific. This is what SharedState is for.

## Approach

The SharedState paradigm is characterized by the following design objectives:

- **Level of Granularity**: State sharing is implemented at the level of individual application abstractions, such as `variables` and `collections` This creates flexibility in application design, as it allows sharing scopes and access restrictions to be defined on a per-resource basis, as opposed to once for a large monolithic data model.

- **Client-side State Replication**: SharedState resources are hosted online, but mirrored locally on clients as `proxies` for online resources. This implies that state **queries** are can be resolved locally with zero latency. State **updates**, by contrast, are processed at the server, and will therefore in principle imply a non-negligible network delay. However, this update delay is effectively masked for the user by applying updates locally first, and then resolving consistency issues as they occur. 

- **Online-first Semantics**: SharedState provides a uniform abstraction for application resources, whether hosted locally or online. However, rather than hiding the distributed nature of resources, SharedState instead adopts the opposite approach - it treats all resources as online resources. This implies that state **updates** are always **asynchronous**, whereas state **queries** are always **synchronous**. 

- **Reactive Programming**: SharedState encourages a reactive programming pattern, moving away from traditional **request-reply** interaction patterns, to a **reactive** pattern, where UI changes are driven by **state changes**.

- **Dumb Server Approach**: SharedState is designed to be generic and domain-agnostic. It addresses state sharing generally through the concept of **item collection**, while remaining agnostic to the structure of **items** within these collections, as well as the purpose of resources within their applications. The relative simplicity of this design ensures that SharedState can be implemented effectively and provide a scalable foundation for state sharing. Moreover, the approach allows more specialized application abstractions to be built on top of this basic concept, such as `SharedVariable`, `SharedMap`, `SharedList`, and `SharedTree`. This supports broad usage across diverse application contexts.



