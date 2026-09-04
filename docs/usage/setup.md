# Setup & Installation

> Comprehensive guide for installing, configuring, and connecting the SharedState server and client library.

---

## 1. Server Environment

The SharedState server requires Python 3.10+ and uses [Poetry](https://python-poetry.org/) for dependency management and environment isolation.

### Installation via Poetry

```bash
# Clone the repository
git clone https://github.com/ingararntzen/shared-state.git
cd shared-state

# Install server dependencies
poetry install
```

### Server CLI Command

The server executable `sharedstate-server` is registered in `pyproject.toml`. Run the server by providing a JSON configuration file path:

```bash
poetry run sharedstate-server config.json
```

---

## 2. Server Configuration

The server configuration file defines the server listening host/port and the set of state stores available for clients to query.

### Configuration Schema

```json
{
  "service": {
    "host": "0.0.0.0",
    "port": 9000,
    "http_log": "logs/http.log",
    "ws_log": "logs/ws.log"
  },
  "stores": [
    {
      "name": "mitems",
      "module": "items_store",
      "config": {
        "db_type": "sqlite",
        "db_name": ":memory:",
        "db_table": "items"
      }
    },
    {
      "name": "items",
      "module": "items_store",
      "config": {
        "db_type": "mysql",
        "db_name": "sharedstate",
        "db_table": "items",
        "db_host": "localhost",
        "db_user": "myuser",
        "db_password": "mypassword",
        "ssl.enabled": false
      }
    }
  ]
}
```

---

## 3. Database Stores Setup

SharedState supports two built-in database engines for storing item collections.

### SQLite Store (Development & In-Memory)
SQLite is ideal for rapid development and testing.

- **In-Memory Store**: `"db_name": ":memory:"` creates a lightweight, ephemeral store cleared on server restart.
- **File-Backed Store**: `"db_name": "data/app.db"` persists state to a local SQLite database file.

### MySQL / MariaDB Store (Persistent Production)
For production persistence across high volumes of concurrent operations, configure a MySQL or MariaDB store.

#### 1. Create Database & User
Run the following SQL commands on your database server:

```sql
-- Create user and database
CREATE USER IF NOT EXISTS 'myuser'@'localhost' IDENTIFIED BY 'mypassword';
CREATE DATABASE IF NOT EXISTS sharedstate;
GRANT ALL PRIVILEGES ON sharedstate.* TO 'myuser'@'localhost';
FLUSH PRIVILEGES;
```

#### 2. SSL/TLS Configuration (Optional)
If your MySQL server requires encrypted connections, set `"ssl.enabled": true` and provide certificate file paths in the store config:

```json
"config": {
  "db_type": "mysql",
  "ssl.enabled": true,
  "ssl.ca": "/path/to/ca.pem",
  "ssl.cert": "/path/to/client-cert.pem",
  "ssl.key": "/path/to/client-key.pem"
}
```

---

## 4. JavaScript Client Library Setup

The SharedState JavaScript client SDK can be imported into modern ES modules or included directly via global script tags.

### Download Public JS Bundles

Pre-built client bundles are available for direct download:

- **[sharedstate.es.js](https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.es.js)** (ES6 Module - Unminified)
- **[sharedstate.es.min.js](https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.es.min.js)** (ES6 Module - Minified)
- **[sharedstate.iife.js](https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.iife.js)** (IIFE Global Script - Unminified)
- **[sharedstate.iife.min.js](https://github.com/ingararntzen/shared-state/raw/main/dist/sharedstate.iife.min.js)** (IIFE Global Script - Minified)

### ES Module Import Syntax

In modern web applications or `<script type="module">` tags:

```html
<script type="module">
  import { SharedStateClient, SharedMap, SharedInteger } from "./dist/sharedstate.es.js";

  const client = new SharedStateClient("ws://localhost:9000");
</script>
```

### IIFE Global Script Inclusion

For traditional script tags without build steps:

```html
<script src="./dist/sharedstate.iife.js"></script>
<script>
  // Access constructors under global SHAREDSTATE namespace
  const client = new SHAREDSTATE.SharedStateClient("ws://localhost:9000");
  const myMap = new SHAREDSTATE.SharedMap(client, "/app/store/mymap");
</script>
```
