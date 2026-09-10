# SharedState Project Roadmap & Todo List

This document tracks active development tasks and potential future extensions for SharedState.

---

## Planned / Active TODOs

Tasks, refactorings, and planned bug fixes currently scheduled for implementation:

### Client API & Synchronization
- [ ] **Subscription Acknowledgment Timing**: Verify state update handling on subscriptions. Ensure local subscription state updates immediately upon local action rather than blocking until server acknowledgment.
- [ ] **Proxy Object Interface Clarification**: Streamline `ProxyObject` / `SharedObject` usage and document object array item manipulation.
- [ ] **Error Recovery & Reconnect Polishing**: Verify client auto-reconnect fallback when WebSocket connections drop abruptly under high traffic.

### Admin Dashboard UI
- [ ] **Resource Detail Enhancements**: Further refine table layouts, pagination, and real-time inspect views for large collection datasets in `html/adm/`.
- [ ] **Connection Diagnostic Panel**: Add real-time latency and server clock skew visualization to the admin interface.

---

## Future Extensions & Ideas

Possibilities, architectural concepts, and potential feature enhancements for future consideration:

### Server & Storage Persistence
- [ ] **Server-Side Filtering**: Implement server-side query filters and projection rules to allow clients to subscribe to subsets of item collections based on predicates.
- [ ] **PostgreSQL & Redis Backends**: Add store adapters for PostgreSQL relational storage and Redis pub/sub for multi-node server scaling.
- [ ] **SSL / TLS Native Hardening**: Test and document native SSL/TLS configuration for production deployments behind reverse proxies (Nginx, Caddy, Traefik).

### Client SDK Expansion
- [ ] **Multi-Platform Client SDKs**: Explore client library implementations for additional languages (e.g. Python client SDK, Swift/iOS client SDK).
- [ ] **Offline Sync & Local Persistence**: Support offline caching of proxy collections with background sync upon reconnection.
