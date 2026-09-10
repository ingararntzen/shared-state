# Client API Overview

The SharedState client is implemented in JavaScript. It encapsulates management of state replication, connection and client subscriptions, while providing easy-to-use programming abstractions modelling shared resources. The SharedState Client API is organized in three parts:


### Definitions API

   - **[`Type Definitions`](/client_api/types)**: Common typedefs, structs, and event info objects.
   - **[`CollectionResource API`](/client_api/collection_resource)**: Path-exclusive collection interface contract.
   - **[`ValueResource API`](/client_api/value_resource)**: Single-value item resource interface contract.


### Client API

   - **[`SharedStateClient API`](/client_api/client)**: The client object maintains a WebSocket connection to a SharedState server.
   - **[`Connection API`](/client_api/connection)**: The connection object provides access to the state of the connection.
   - **[`ServerClock API`](/client_api/clock)**: The server clock object provides access to an approximation of the server clock.



### Shared Objects API

   - **[`Event API`](/client_api/events)**: The event observation interface implemented by all SharedState abstractions.
   - **[`SharedVariables API`](/client_api/variables)**: Abstractions representing shared, single-valued variables, typed and untyped.
   - **[`SharedMap API`](/client_api/map)**: Abstraction representing a shared key-value map.
   - **[`SharedSet API`](/client_api/set)**: Abstraction implementing a shared set.
