# The SharedState Paradigm

> - SharedState enables online state sharing at the level of individual application variables and resources.


## Introduction

Traditional web development is typically split between two concerns: developers express interface functionality synchronously through the manipulation of in-memory variables, and then switch to an asynchronous model for managing online-hosted resources.

## Objective

The objective of SharedState is **not to remove this distinction**, but to make it easy to **share application state at a lower granularity** such as individual variables or objects.

## Approach

SharedState achieves this through five core design choices:

- **Level of Granularity**: Implementing state sharing at the level of individual variables and collections, as opposed to larger data models. This creates significant flexibility in application design, as sharing scopes and access restrictions may be set on a per-resource basis instead of per-service.

- **Client-Side State Replication**: SharedState resources are hosted as online resources, but replicated on clients and made available locally as proxy objects. Querying shared state is a local, synchronous operation, whereas updating state is an asynchronous operation with a non-negligible network delay.

- **Reactive Programming**: SharedState encourages a reactive programming model, moving away from traditional request-reply interaction patterns to a model where application code reacts to changes in shared state and dispatches updates to the shared state service.

- **Uniform Resource Abstractions**: SharedState provides a uniform abstraction for application resources, whether hosted locally or online. This creates the flexibility to develop application logic that is reusable across different sharing scopes. Moreover, by using common representations for stateful resources, complexity with state sharing may be provided for a wide range of resource types, from single variables to complex data structures.

- **Application-Defined Representation**: SharedState is only concerned with state sharing and remains agnostic to the internal representation of state. This allows applications to freely define the internal representation of stateful resources without relying on standardization efforts or server-side schema definitions. Resources are created simply by posting state to a resource identifier (i.e., a path). In this sense, SharedState is similar to an application-level **key-value store**. 





