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

Start the Python SharedState server with a configuration file:

```sh
# Using poetry from project root folder
poetry run sharedstate-server cfg/default.json

# Or, from within an activated venv 
eval $(poetry env activate)
sharedstate-server cfg/default.json
deactivate
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
