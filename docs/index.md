---
layout: home

hero:
  name: "SharedState"
  text: "Real-time State Synchronization Framework"
  tagline: "Local proxies for online-hosted variables and collections. Python server & JavaScript client."
  actions:
    - theme: brand
      text: Concept
      link: /concept/paradigm
    - theme: alt
      text: Design
      link: /design/framework
    - theme: alt
      text: Client API Reference
      link: /client-api/

features:
  - title: Local Proxies, Online Data
    details: Query state locally with zero network latency. Modifications are asynchronously synchronized across all connected clients.
  - title: Application-Defined State
    details: The server acts as a generic, state-agnostic host. Applications define data formats and semantics without server-side friction.
  - title: Small Independent Resources
    details: Build application state out of many small, fine-grained independent resources that can be hosted and shared independently.
  - title: Pluggable Storage & Time Sync
    details: Swap storage backends (MySQL, SQLite, memory) and leverage built-in network clock synchronization for time-consistent playback.
---
