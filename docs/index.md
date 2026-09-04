---
layout: home

hero:
  name: "SharedState"
  text: "Real-time State Synchronization Framework"
  tagline: "Real-time shared variables and collections with Strong Eventual Consistency. Python server & JavaScript client."
  actions:
    - theme: brand
      text: Get Started
      link: /usage/quickstart
    - theme: alt
      text: Documentation
      link: /concept/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/ingararntzen/shared-state

features:
  - title: Zero-Latency Local Queries
    details: Application Objects (SharedMap, SharedSet, SharedVariable) query local memory instantly while optimistic updates stream over WebSockets.
  - title: Strong Eventual Consistency
    details: Server-authoritative replication ensures all connected clients deterministically converge to the exact same state without race conditions.
  - title: Application-Defined Semantics
    details: State-agnostic server supporting arbitrary JSON data formats, fine-grained resource paths, and custom store schemas.
  - title: Pluggable Persistence & Time Sync
    details: Flexible storage backends (MySQL, SQLite, in-memory) coupled with a high-precision synchronized server clock.
---
