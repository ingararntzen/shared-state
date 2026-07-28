# Resource Semantics

> - SharedState resources operate with dictionary semantics rather than filesystem semantics.
> - Namespaces are defined implicitly through the creation of resources on paths.

For general concepts, see [The SharedState Paradigm](/overview/paradigm.md).

---

## Dictionary vs. Filesystem Semantics

Traditional storage and filesystems require explicit operations to allocate containers or namespaces (such as `mkdir` or `CREATE TABLE`) before data can be stored.

SharedState eliminates this setup step:
* **Implicit Namespaces**: Writing to a resource path automatically instantiates the resource and its parent namespace.
* **Zero-Friction Access**: Creating, observing, or updating a path behaves like accessing keys in a local dictionary.

---

## Local vs. Online Resource Mental Model

SharedState unifies the programming interface across local in-memory variables and online-hosted resources while explicitly respecting their distributed performance differences:

* **Queries**: Resolved instantly against local proxy replicas with zero network latency.
* **Updates**: Asynchronous network dispatches carrying propagation delay.

Local resources are simply a special case where update latency happens to be lower.
