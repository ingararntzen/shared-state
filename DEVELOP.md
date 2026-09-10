# SharedState Development Guide

This guide describes how to set up, build, test, and contribute to the SharedState repository.

---

## Project Folder Organization

```text
shared-state/
├── client/              # JavaScript client library source files
│   ├── index.js         # Main entry point & SharedStateClient class
│   ├── connection.js    # WebSocket connection & reconnection manager
│   ├── clock.js         # Server clock estimation & synchronization
│   ├── object.js        # Core BaseAbstraction & state proxies
│   ├── definitions/     # Type definitions and typedefs
│   └── util/            # Helper utilities (resolvablePromise, etc.)
├── src/                 # Python server package source code
│   └── sharedstate/     # Server core, connection handlers, and stores
├── cfg/                 # Server configuration examples (sqlite.json, sql.json)
├── html/                # Admin Web UI & demonstration pages
│   ├── adm/             # Admin panel web interface
│   └── examples/        # Interactive browser demo pages
├── dist/                # Output directory for compiled client JS bundles
├── docs/                # Documentation source files (MkDocs / GitHub Pages)
├── scripts/             # Build scripts (e.g. generate-api-docs.js)
├── tests/               # Automated test suites
│   ├── client/          # JS client tests (Vitest)
│   └── server/          # Python server tests (Pytest)
├── DEVELOP.md           # Developer setup and contribution guide
├── README.md            # Repository overview & quick links
├── SKILL.md            # Agent skill guide for AI assistants
├── TODO.md             # Planned tasks and future extension roadmap
├── package.json         # npm dependencies and script definitions
├── pyproject.toml       # Python Poetry package & dependency configuration
└── vite.config.js       # Vite configuration for JS bundling
```

---

## Environment Setup

Ensure you have **Node.js** (v18+) and **Python** (v3.10+) with **Poetry** installed.

```sh
# 1. Install Python server dependencies
poetry install

# 2. Install JavaScript client dependencies
npm install
```

---

## Repository Script Commands

### Building Client JS Bundles

SharedState uses [Vite](https://vitejs.dev/) to compile the client library into single-file ES modules and IIFE bundles:

```sh
# Build development bundles in dist/ (sharedstate.es.js, sharedstate.iife.js)
npm run build

# Build production minified bundles in dist/ (sharedstate.es.min.js, sharedstate.iife.min.js)
npm run build:dist
```

### Running the Python Server

Start the Python SharedState WebSocket server locally:

```sh
# Start server with default in-memory SQLite store
poetry run sharedstate-server

# Or start server with a specific configuration file
poetry run sharedstate-server cfg/sqlite.json
poetry run sharedstate-server cfg/sql.json
```

- **Admin Web UI**: Once the server is running, open `http://localhost:9000/` in your browser to access the interactive admin dashboard (`html/adm/`).
- **WebSocket Endpoint**: Clients connect to `ws://localhost:9000/`.

### Generating API Documentation

Client API documentation files are generated directly from JSDoc docstrings in `client/` source files:

```sh
# Re-generate client Markdown documentation in docs/client_api/
node scripts/generate-api-docs.js
```

---

## Running Test Suites

### Client Tests (Vitest)

Execute JavaScript client unit and integration tests:

```sh
# Run client test suite once
npm test

# Run tests in watch mode during client development
npx vitest
```

### Server Tests (Pytest)

Execute Python server unit and connection tests:

```sh
# Run Python server test suite
poetry run pytest
```
