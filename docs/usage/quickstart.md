# Quickstart

> Get up and running with SharedState in under 5 minutes.

---

This quickstart shows how to run the SharedState server locally and how to load the SharedState client in a web page.

---

## 1. Start the Server

The SharedState server is written in Python. By default, it runs with an in-memory SQLite store requiring no database installation.

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

2. Create a minimal configuration file named `config.json`:
   ```json
   {
     "service": {
       "host": "0.0.0.0",
       "port": 9000
     },
     "stores": [
       {
         "name": "store",
         "module": "items_store",
         "config": {
           "db_type": "sqlite",
           "db_name": ":memory:",
           "db_table": "items"
         }
       }
     ]
   }
   ```

3. Launch the server:
   ```bash
   poetry run sharedstate-server config.json
   ```

   The server will start listening at `http://0.0.0.0:9000` for both HTTP requests and WebSocket connections. You may open the link in a browser to verify that the server is running, or to inspect the administrative server interface.

---

## 2. Create a Web Page

Create an `index.html` file in your workspace. This page connects to the server and binds a `SharedInteger` variable to a button:

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
    import { SharedStateClient, SharedInteger } from "https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.es.js";

    // 1. Connect to the local SharedState server
    const client = new SharedStateClient("ws://localhost:9000");

    // 2. Bind a SharedInteger variable to path /app/store/vars and name "counter"
    const counter = new SharedInteger(client, "/app/store/vars", "counter", {
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

## 3. Test Real-Time Synchronization

1. Open `index.html` in your browser.
2. Open the **same `index.html` file in a second browser window** side by side.
3. Click **"Increment Counter"** in Window 1.

Notice how Window 2 updates **instantly** in real time! You have successfully configured and executed your first SharedState application.
