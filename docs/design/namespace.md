# Strict Hierarchical Namespace

> - SharedState resources are scoped using a strict 3-part path format.
> - Path structure enforces clear isolation across applications, services, and channels.

For pathing basics, see [Resources](/design/resources.md).

---

## 3-Part Path Hierarchy

Every resource path must strictly follow the format:

```
/app-name/service-name/resource-name
```

### Path Components

* **`app-name`**: Multi-tenant application identifier.
* **`service-name`**: Name of the storage service module handling persistence.
* **`resource-name`**: Specific resource channel or collection name.

---

## Application Sub-Partitioning

While the 3-part server path structure is strict, applications can define sub-namespaces within `resource-name` using custom delimiters (e.g. dots or hyphens):

```
/myapp/items/room1.chat
/myapp/items/room1.whiteboard
```

This keeps server-side path parsing fast and unambiguous while providing unlimited naming flexibility to application developers.
