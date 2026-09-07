# SharedState Development Guide


## Environment Setup

```sh
# Create venv for server
poetry install
# Install dependencies
npm install
```


## Build JS Bundles

Build JS bundles in `dist/`:

```sh
# Bundles (es and iife)
npm run build

# Minified bundles (es and iife)
npm run build:dist
```

## Start the Server

Start the Python SharedState server:

```sh
# Default in-memory SQLite store (no config argument needed)
poetry run sharedstate-server

# Or specify a custom configuration file (e.g., SQLite or MySQL)
poetry run sharedstate-server cfg/sqlite.json
poetry run sharedstate-server cfg/sql.json
```

- Once running, open your browser to **http://localhost:9000/** to view the administrative interface.
- The client bindings use **ws://localhost:9000/** as endpoint for websocket traffic.


---

## Running Tests

### Client Tests (Vitest)
```sh
npm test
```

### Server Tests (Pytest)
```sh
poetry run pytest
```
