# Improvements & Extensions

This document lists possible improvements and potential future extensions for SharedState.

---

## Attractive Improvements 

- **Binary serialization**: Switch to a binary format for communication between client and server to reduce bandwidth and avoid sending data in JSON format.

---

## Future Extensions & Ideas

- **Server-side Filtering**: Support server-side filtering, allowing clients to observe only a subset or an otherwise large resource.
- **Transaction Suppoert**: Atomic updates across resources, possibly across servers.
- **New Abstractions**: Support new abstractions, such as `List`, or `Queue`, `Treee`
- **New Stores**: Add support for new types of data stores with index support for temporal and spatial data. This in combination with server-side filtering.

---