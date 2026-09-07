# Quickstart

> Get up and running with SharedState in three easy steps.

---
## 1. Install

- Clone from GitHub
- Install dependencies.

```bash
git clone https://github.com/ingararntzen/shared-state.git
cd shared-state
poetry install
```

---
## 2. Run

- Start the SharedState server. 
- Note the server URL in the terminal output, typically `http://localhost:9000/`


```sh
poetry run sharedstate-server
```

---
## 3. Play

- Open `SharedMap` demo (`docs/html/examples/map.html`) in **two** browser tabs.
- Make changes in either tab and observe real-time updates in both.


```sh
xdg-open http://localhost:9000/files/examples/map.html
```
