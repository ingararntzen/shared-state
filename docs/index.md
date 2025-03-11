# Shared State

This project provides a Python server and JavaScript client for real-time data
sharing. Shared state implies that multiple (Web) clients may connect to a
shared resource on a server, and maintain a local proxy, which is automatically
kept in sync with the server-side resource. If a client requests modification of
the shared resource, all clients will observe the modification. Importantly,
applications define the data-format for resource and what role resources play in
the application. As such, Share State is a generic tool for state sharing. Communication between client and server is implemented over websocket connections.



## Usage

Script downloads.

- [sharedstate.es.js](libs/sharedstate.es.js)
- [sharedstate.iife.js](libs/sharedstate.iife.js)



## Server Installation









### Limitations

* Currently, communication is plain text. SSL support has not been tested.

* Currently no support for server-side filtering, though the server design is open to this feature as a future extension.

* The provided client code is limited to JavaScript, implying that state
sharing is limited the Web platform and nodejs environments. However,
the concept itself is open to state sharing across any (connected) platform, 
provided only that a client implementation exists for the platforms.


# Documentation Overview


The server hosts named collections of items, and allow clients
to monitor dynamic changes within these collections, including
removal, addition or modifications of items. Communication
is multiplexed over a single websocket connection, even if
clients monitor multiple item collections on the server.





