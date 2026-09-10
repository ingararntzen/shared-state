# SharedState

[![Documentation](https://img.shields.io/badge/docs-online-blue.svg)](https://ingararntzen.github.io/shared-state/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 📖 **Full Documentation**: Visit the official [SharedState Documentation](https://ingararntzen.github.io/shared-state/) for comprehensive guides, tutorials, architecture overviews, and API references.

---

## Overview

**SharedState** is a lightweight real-time state synchronization framework consisting of a high-performance Python server and a modern JavaScript client library.

It enables web applications and microservices to maintain local data models that stay automatically synchronized across multiple clients in real-time over WebSocket connections. When any client modifies a shared resource, all connected clients immediately observe the update.

---

## Key Features

- **Automatic Synchronization**: Local proxy models automatically sync with server-side resources.
- **Multiplexed WebSockets**: Efficiently handle multiple state subscriptions and high-frequency updates over a single WebSocket connection.
- **High-Precision Clock Sync**: Built-in server clock estimation and round-trip time latency tracking for coordinated playback and synchronized user experiences.
- **Flexible Persistence**: Built-in support for SQLite (in-memory or file-backed) and MySQL storage backends.
- **Rich Data Abstractions**: High-level structures including `SharedMap`, `SharedSet`, `SharedVariable`, `SharedInteger`, and `SharedArray`.
- **Browser & Node Support**: Bundled as standard ES modules and IIFE scripts for browser runtime or Node.js environments.

---

## Project Origins & Status

- **Origins**: SharedState was created by Ingar Arntzen to simplify real-time interactive web applications, collaborative interfaces, and multi-screen synchronization without requiring heavy database sync infrastructure.
- **Status**: Active development (v1.0 architecture). The Python server and JavaScript client APIs are fully functional and tested across continuous integration test suites.

---

## Quick Download & Script Includes

You can import the JavaScript client directly into your browser applications using standard module imports or global bundle tags:

### ES6 Module Import

```html
<script type="module">
    import { SharedStateClient } from "https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.es.js";
    const client = new SharedStateClient("ws://localhost:9000");
</script>
```

### Global Script Import (IIFE)

```html
<script src="https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.iife.js"></script>
<script>
    const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
</script>
```

---

## Documentation & Developer Resources

For detailed instructions on installation, configuration, client APIs, and contributing:

- 📚 **User Guide & API Docs**: [https://ingararntzen.github.io/shared-state/](https://ingararntzen.github.io/shared-state/)
- 🛠️ **Development Guide**: See [DEVELOP.md](DEVELOP.md) for environment setup, building client bundles, running tests, and folder organization.
- 📋 **Project Roadmap & Todo List**: See [TODO.md](TODO.md) for planned tasks and future extension ideas.

---

## Authorship & License

- **Author**: Ingar Mæhlum Arntzen
- **License**: Released under the [MIT License](LICENSE).