[ItemStore]: /design/representation/item_store.md
[ItemStores]: /design/representation/item_store.md
[Path]: /design/representation/item_collection.md#path


# Server Setup

> How to install, start, and configure the SharedState Python server.

---


## Installation

Clone the repository and install server dependencies using Poetry:

```bash
# Clone the repository
git clone https://github.com/ingararntzen/shared-state.git
cd shared-state

# Install dependencies into Poetry environment
poetry install
```

Dependenciees are specified in `pyproject.toml`.

---

## Start Server

The server executable `sharedstate-server` is registered as a CLI command in `pyproject.toml`.

```bash
# default 
poetry run sharedstate-server 
# start with config
poetry run sharedstate-server cfg/sqlite.json
```

```text
SharedState: Server listening at http://0.0.0.0:9000 (HTTP & WebSockets)
```

By default, the server runs on port 9000 with a single [ItemStore] backed by SQLite, requiring no external database installation or setup. 

The server port may be specified in the server config file. If the desired port is already in use, the server binds to the next available port and logs a notice.

```text
SharedState: Requested port 9000 in use. Automatically bound to port 9001.
SharedState: Server listening at http://0.0.0.0:9001 (HTTP & WebSockets)
```



## Server Config

Server configuration files contain two top-level keys: `"service"` and `"stores"`.

### Service Config
The Service Config (`"service"`) defines global options for the SharedState service:

- **`"host"`**: Network interface binding (`0.0.0.0` for all interfaces, `127.0.0.1` for localhost only).
- **`"port"`**: Requested port number for HTTP and WebSocket traffic.
- **`"http_log"` / `"ws_log"`**: Rotating log file paths (limited to ~100 KB with 1 backup).

### Store Config
The Store Config (`"stores"`) defines options for each [ItemStore]:

- **`"name"`**: Name of the store, as it appears in the service namespace (e.g. `/resources/app/[store_name]/resource`).
- **`"module"`**: Name of python module implementing the [ItemStore]. The module most be located in `src/sharedstate/stores/`, and must be named `[module].py`. 
- **`"description"`**: Optional description of the store.

Remaining entries in the store config are specific to the underlying [ItemStore], and will be forwarded to the class constructor.

### Example Config

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
      "name": "items",
      "module": "item_store",
      "description": "SQLite In-Memory Item Store",
      "config": {
        "db_type": "sqlite",
        "db_name": ":memory:",
        "db_table": "items"
      }
    }
  ]
}
```


---

## Administrative Dashboard

Once the server is running, its administrative interface is available at `http://localhost:9000/`. The administative interface allows for interactive exploration of  server status (clients, client subscriptions), and server namespace, including apps, [ItemStores], and resources.

```sh
xdg-open http://localhost:9000/
```


---
## Database Setup

SharedState only provides one single implementation for [ItemStore]. This may however, be configured to use either SQLite or MySQL/MariaDB. The implementation is located in `src/sharedstate/stores/item_store.py`.


### SQLite Store
SQLite is ideal for rapid prototyping, local development, and automated testing.

The [ItemStore] implementation (`stores/item_store.py`) expects two options.

- **`"db_type"`**: Type of database ("sqlite")
- **`"db_name"`**: Name of database file (e.g. "/path/to/database.db" | ":memory:")

Special name `":memory:"` means that the database is not file-backed, but kept in memory.

```json
{
  "db_type": "sqlite",
  "db_name": ":memory:"
}
```


### MySQL / MariaDB Store
MySQL/MariaDB is used for production persistence and high volumes of concurrent operations.

The [ItemStore] implementation (`stores/item_store.py`) expects two options.

- **`"db_type"`**: Type of database ("mysql")
- **`"db_name"`**: Name of mysql database
- **`"db_table"`**: Name of table in the database
- **`"db_host"`**: Hostname or IP of mysql server
- **`"db_user"`**: Username for mysql server
- **`"db_password"`**: Password for mysql server
- **`"ssl.enabled"`**: Enable SSL/TLS encryption for mysql server
- **`"ssl.ca"`**: Path to CA certificate for mysql server
- **`"ssl.cert"`**: Path to client certificate for mysql server
- **`"ssl.key"`**: Path to client key for mysql server


```json
{
  "db_type": "mysql",
  "db_name": "<database>",
  "db_table": "<table>",
  "db_host": "localhost",
  "db_user": "<user>",
  "db_password": "<password>",
  "ssl.enabled": true,
  "ssl.ca": "/path/to/ca.pem",
  "ssl.cert": "/path/to/client-cert.pem",
  "ssl.key": "/path/to/client-key.pem"
}
```

Create a user and database using the following MySQL commands on your database server:

```sql
CREATE USER IF NOT EXISTS '<user>'@'localhost' IDENTIFIED BY '<password>';
CREATE DATABASE IF NOT EXISTS <database>;
GRANT ALL PRIVILEGES ON <database>.* TO '<user>'@'localhost';
FLUSH PRIVILEGES;
```
