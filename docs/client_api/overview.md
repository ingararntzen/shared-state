# Client API Overview

The **SharedState Client API** provides real-time state replication, reactive variables, collection abstractions, and server clock synchronization for JavaScript applications.

## Client Architecture

The Client API is organized around three primary layers:

1. **Core Client & Network Transport**
   - **[`SharedStateClient`](/client_api/client)**: Logical client instance managing state subscriptions and provider caches.
   - **[`Connection`](/client_api/connection)**: Connection transport manager handling reconnection and network state (`client.connection`).
   - **[`Clock (ServerClock)`](/client_api/clock)**: High-resolution server clock estimator measuring network latency, skew, and transit delay (`client.clock`).

2. **Event System**
   - **[`Events`](/client_api/events)**: Decoupled event system (`.on`, `.off`, `.once`) powering reactive updates across all abstractions.

3. **State Abstractions**
   - **[`SharedVariables`](/client_api/variables)**: Reactive single-value variables (`SharedBoolean`, `SharedInteger`, `SharedFloat`, `SharedString`, `SharedObject`, `SharedArray`).
   - **[`SharedMap`](/client_api/map)**: Replicated key-value map interface.
   - **[`SharedSet`](/client_api/set)**: Replicated set collection interface.
