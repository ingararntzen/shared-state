# SharedState

[![Documentation](https://img.shields.io/badge/docs-online-blue.svg)](https://ingararntzen.github.io/shared-state/)
[![License: BSD 2-Clause](https://img.shields.io/badge/License-BSD_2--Clause-orange.svg)](https://github.com/ingararntzen/shared-state/blob/main/LICENSE)



> 📖 **Documentation**: Visit the [SharedState Documentation](https://ingararntzen.github.io/shared-state/) for comprehensive guides covering usage, core concepts, design architecture, and API references.

---

## Overview

**SharedState** is a lightweight real-time state synchronization framework consisting of a WebSocket server (in Python) and a JavaScript client library.

SharedState extends familiar programming primitives—integers, booleans, strings, arrays, and maps—with native support for online state sharing, thereby turning them into generic building blocks for multi-user and multi-device web applications.

---

## Key Features

- **Local State Access**: SharedState enables highly interactive and responsive applications by mirroring server state on the client, handling queries and updates as zero-delay local operations.
- **Automatic Synchronization**: Local proxy models automatically sync with server-side resources.
- **Automatic Reconnection**: The client automatically reconnects to mask intermittent network issues.
- **Strong Eventual Consistency**: SharedState provides replication with strong eventual consistency, maintaining the integrity of client sessions despite network failures.
- **Data Sharing & Distributed Control**: SharedState supports both data sharing and distributed control—enabling live monitoring, multi-user editing, and multi-device coordination.
- **Familiar Programming Model**: Like traditional, single-process programming, SharedState allows application developers to define a custom data model through the combination of generic programming abstractions.
- **Generic Programming Abstractions**: SharedState offers generic programming abstractions with built-in support for online synchronization, including *variable types* (e.g., `SharedInteger`, `SharedFloat`, `SharedString`) and *collection types* (`SharedMap`, `SharedSet`).
- **Global Scope**: Unlike traditional programming, SharedState programming abstractions are backed by server state, and can be accessed and mutated from any connected interfaces, globally.
- **Persistence**: Built-in support for server-side persistency ensures that the lifespan of SharedState programming abstractions is not cut short by server restarts.
- **Reactive Programming**: SharedState is a great fit for reactive rendering frameworks, offering programming abstractions with change events and asynchronous update semantics.
- **Browser & Node Support**: Bundled as standard ES modules and IIFE scripts for browser runtime or Node.js environments.
- **Extensible**: SharedState is extensible with new storage backends and programming abstractions.

---

## Project Origins & Status

- **Origins**: The SharedState framework is the culmination of many years of experimentation with different realizations of this idea, by Ingar M. Arntzen and Njål T. Borch.

- **Framework Status**: The framework currently provides the minimal functionality required for effective usage and is well documented. The Python server and JavaScript client APIs are fully functional and tested across continuous integration test suites. However, the implementation is **not** ready for large-scale deployment at this point, but provides an excellent basis for prototyping collaborative, multi-device web applications.

- **Maintenance Status**: The framework is built and maintained by Ingar M. Arntzen. It has reached a stable state, and no changes or further development is currently planned, except for bug fixes.

- **Funding**: This project has no sponsor. If you think the framework should have a sponsor, please reach out: [ingar.arntzen@gmail.com](mailto:ingar.arntzen@gmail.com)

- **Future Extensions**: A list of possible improvements and extensions is provided in [TODO.md](TODO.md)
 
---

## Quickstart

### 1. Start the Server

Install and start the Python server:

```sh
# Option A: Install directly via pip and start server
pip install git+https://github.com/ingararntzen/shared-state.git
sharedstate-server

# Option B: Clone repository and start with Poetry
git clone https://github.com/ingararntzen/shared-state.git
cd shared-state
poetry install
poetry run sharedstate-server
```

By default, the server runs on `ws://localhost:9000` with an in-memory SQLite store and serves the admin interface at `http://localhost:9000/`.

### 2. Connect the Client

You can import the JavaScript client directly into your browser applications using standard module imports or global bundle tags:

#### ES6 Module Import

```html
<script type="module">
    import { SharedStateClient } from "https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.es.js";
    const client = new SharedStateClient("ws://localhost:9000");
</script>
```

#### Global Script Import (IIFE)

```html
<script src="https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.iife.js"></script>
<script>
    const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
```

---

## Documentation & Developer Resources

For detailed information on usage, design, and client APIs:

- 📚 **User Guide & API Docs**: [https://ingararntzen.github.io/shared-state/](https://ingararntzen.github.io/shared-state/)

For information about project development:

- 🛠️ **Development Guide**: See [DEVELOP.md](DEVELOP.md) for environment setup, building client bundles, running tests, and folder organization.

---

## Authorship & License

- **Author**: Ingar Mæhlum Arntzen
- **License**: Released under the [BSD 2-Clause License](LICENSE).