# Quickstart

> Get up and running with SharedState in under 5 minutes.

---



::: tip SharedState in three simple steps

1. Start the SharedState server. 

```sh
poetry run sharedstate-server
```
2. Note the server URL in the terminal output, typically `http://localhost:9000/`
3. Open [http://0.0.0.0:9000/files/examples/map.html](http://0.0.0.0:9000/files/examples/map.html) in two browser tabs.
:::

That is it! Now make changes in one of the tabs and observe real-time updates in both.


---

## 1. Start the Server

The SharedState server is written in Python. By default, it runs with in-memory SQLite stores requiring no database installation or external services.

### Prerequisites
- **Python**: 3.10 or newer
- **Poetry**: Python dependency manager

### Installation & Execution

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/ingararntzen/shared-state.git
   cd shared-state
   poetry install
   ```

2. Launch the server (uses `cfg/sqlite.json` by default):
   ```bash
   poetry run sharedstate-server
   ```

   The server will start listening at `http://0.0.0.0:9000` for HTTP static asset requests, REST API calls, and WebSocket connections. If port 9000 is occupied, it will automatically bind to the next available port.


---

## 3. Create a Custom Web Page

To create your own standalone HTML file in your workspace, bind a `SharedInteger` variable to a button:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SharedState Quickstart</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; }
    button { font-size: 1.2rem; padding: 0.5rem 1rem; cursor: pointer; }
    .counter { font-size: 2rem; font-weight: bold; margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>Shared Counter</h1>
  <div class="counter" id="counter-val">0</div>
  <button id="inc-btn">Increment Counter</button>

  <script type="module">
    import { SharedStateClient, SharedInteger } from "https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js";

    // 1. Connect to the local SharedState server
    const client = new SharedStateClient("ws://localhost:9000");

    // 2. Bind a SharedInteger variable to path /app/items/vars and name "counter"
    const counter = new SharedInteger(client, "/app/items/vars", "counter", {
      allowUndefined: false,
      defaultValue: 0
    });

    const display = document.getElementById("counter-val");
    const button = document.getElementById("inc-btn");

    // 3. Reactively update the UI whenever the counter changes (with init: true for initial render)
    counter.on("change", () => {
      display.textContent = counter.value;
    }, { init: true });

    // 4. Increment counter on button click
    button.addEventListener("click", () => {
      counter.inc(1);
    });
  </script>
</body>
</html>
```

---

## 4. Test Real-Time Synchronization

1. Open your page in a browser window.
2. Open the **same page in a second browser window** side by side.
3. Click **"Increment Counter"** in Window 1.

Notice how Window 2 updates **instantly** in real time! You have successfully executed your first SharedState application.



---

## 2. Out-of-the-Box Demo Applications

The SharedState server serves static demo applications under `/files/` directly out of the box. These demos import JavaScript SDK source files natively—requiring **only the running Python server** (no frontend build step, `npm install`, or database setup required).

Open any of the following URLs in your web browser:

- **Admin Overview**: `http://localhost:9000/files/adm/index.html` (inspect active server endpoints, registered stores, connected WebSocket clients, and subscriptions).
- **SharedMap Demo**: `http://localhost:9000/files/examples/map.html` (real-time key-value collection viewer with add/update/delete operations).
- **SharedInteger Demo**: `http://localhost:9000/files/examples/integer.html` (real-time counter showcasing `inc()`, `dec()`, and `set()`).
- **Minimal Counter**: `http://localhost:9000/files/examples/minimal.html` (lightweight, unstyled counter example created with `load()`).
- **Layer 1 Provider**: `http://localhost:9000/files/examples/provider.html` (demonstrates low-level `ItemProvider` collection mutations).
- **Monotonic Clock Sync**: `http://localhost:9000/files/examples/clock.html` (real-time client-server clock drift and skew monitoring).
