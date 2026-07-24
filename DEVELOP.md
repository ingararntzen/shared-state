# JavaScript Client build & development

```sh
# install dependencies
npm install

# build bundles to html/libs
npm run build

# build including minimized bundles
npm run build:dist

# start dev webserver (defaults to port 9001)
npm start

```

### Dev Server Port Configuration

The Vite development web server defaults to port `9001`. You can configure the port using environment variables or CLI flags:

```sh
# Default start (runs on port 9001)
npm start

# Custom port via environment variable PORT
PORT=8001 npm start

# Custom port via environment variable VITE_PORT
VITE_PORT=8080 npm start

# Custom port via CLI flag
npm start -- --port 8080
```

### Explorer Application WebSocket Target Port

The Explorer application (`html/index.html`) automatically connects to the Python SharedState server on port `9000` by default. You can override the target WebSocket port via the URL query parameter:

- Default connection: `http://localhost:9001/` (connects to `ws://localhost:9000`)
- Custom WebSocket port: `http://localhost:9001/?port=9002` (connects to `ws://localhost:9002`)


# Client Testing (Vitest)

```sh
npm test
```

# Server Testing (Pytest)

```sh
poetry run pytest
```
