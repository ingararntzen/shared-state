# Deployment & Security

> Best practices for deploying the SharedState server to production using Docker, reverse proxies, and TLS encryption.

::: warning Work in Progress
The SharedState framework is currently an active research and development project under continuous refinement. It has **not been verified as production quality** or certified for high-availability, mission-critical deployments at this point. Use in production environments at your own discretion.
:::

---

Production deployments of SharedState typically run behind a reverse proxy (such as Nginx or Caddy) handling SSL/TLS encryption (`wss://`) and WebSocket connection upgrades.

---

## 1. Reverse Proxy TLS Termination (Recommended)

Running Nginx or Caddy in front of the SharedState Python server is the recommended architecture for production services.

### Advantages
- **Automatic SSL Certificates**: Integration with ACME clients (e.g. Let's Encrypt / Certbot) for free, auto-renewing TLS certificates.
- **Zero Python Overhead**: Security headers, SSL handshakes, and port 443 listening are handled by high-performance C web servers.
- **Static Asset Serving**: Serves front-end HTML/JS files directly at high speed.

### Nginx Configuration Example

Add the following location block to your Nginx configuration (`/etc/nginx/sites-available/default`):

```nginx
server {
    listen 443 ssl http2;
    server_name sharedstate.example.com;

    ssl_certificate /etc/letsencrypt/live/sharedstate.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sharedstate.example.com/privkey.pem;

    # Static web app assets
    location / {
        root /var/www/html;
        index index.html;
    }

    # Proxy WebSocket & HTTP requests to SharedState Python server
    location /ws/ {
        proxy_pass http://127.0.0.1:9000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s; # Prevent timeout on idle WebSocket connections
    }
}
```

Client connections can then specify secure WebSockets:

```javascript
const client = new SharedStateClient("wss://sharedstate.example.com/ws/");
```

---

## 2. Docker Container Deployment

The SharedState server requires no code changes to run inside Docker containers.

### Dockerfile Template

Create a `Dockerfile` in the root of your project:

```dockerfile
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Poetry
RUN pip install --no-cache-dir poetry

# Install Python dependencies
COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi --without dev

# Copy server source code and default config
COPY src/ ./src/
COPY cfg/ ./cfg/

EXPOSE 9000

CMD ["python", "-m", "sharedstate.ss_server", "cfg/config.json"]
```

### Build & Run Container

```bash
# Build Docker image
docker build -t sharedstate-server .

# Run container exposing port 9000
docker run -d -p 9000:9000 --name sharedstate sharedstate-server
```

---

## 3. Process Management (Systemd)

To ensure the server restarts automatically on system reboots or unhandled crashes, create a systemd service unit:

`/etc/systemd/system/sharedstate.service`:

```ini
[Unit]
Description=SharedState Server Daemon
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/shared-state
ExecStart=/root/.local/bin/poetry run sharedstate-server /opt/shared-state/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sharedstate
```
