# Unified Single-Port Architecture

> - SharedState serves WebSockets, HTTP REST administration APIs, and static assets from a single port.
> - Simplifies deployment, firewall configuration, and Docker container setup.

For server CLI details, see [Server Setup](/server-admin/).

---

## Single-Port Routing Mechanism

The SharedState server listens on a single port (default `9000`) and inspects incoming HTTP connection headers:

```
Incoming Request (Port 9000)
        │
        ├── Header contains "Upgrade: websocket" ──► WebSocket Handler Engine
        │
        └── Standard HTTP Request ────────────────► HTTP REST & Static File Server
```

---

## Unified Services Hosted

1. **WebSocket Protocol**: Real-time state synchronization, subscription handling, and change notifications.
2. **HTTP REST Admin Endpoints**: `/api/config`, `/api/services`, `/api/subscriptions`, `/api/log/http`, `/api/log/ws`.
3. **Static Web Assets**: Serves built JavaScript client bundles (`dist/`) and the embedded Explorer web application (`html/index.html`).

---

## Benefits

* **Deployment Simplicity**: Requires opening only one port in firewalls, reverse proxies (Nginx, Traefik), and cloud container instances.
* **No CORS Friction**: Frontend assets and WebSocket servers share the same origin by default.
