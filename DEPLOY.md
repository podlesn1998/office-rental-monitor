# Timeweb VPS Deployment Guide

This guide describes how to deploy the Office Rental Monitor on a Timeweb VPS (or any Debian/Ubuntu-based server) using Docker.

## Prerequisites

- A Timeweb VPS with Ubuntu 22.04 or Debian 12 (at least 2 GB RAM recommended for Playwright/Chromium)
- Docker and Docker Compose installed
- A MySQL 8 database (Timeweb managed DB, or a self-hosted container)
- The project cloned from GitHub

## Step 1 — Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/office-rental-monitor.git
cd office-rental-monitor
```

## Step 2 — Create the environment file

Create a file named `env.production` in the project root (add it to `.gitignore`):

```bash
nano env.production
```

Fill in the required values:

```
DATABASE_URL=mysql://user:password@host:3306/dbname
JWT_SECRET=<run: openssl rand -hex 32>
NODE_ENV=production
PORT=3000
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Manus OAuth (leave empty to disable web login)
VITE_APP_ID=
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im
OWNER_OPEN_ID=
OWNER_NAME=

# Manus Forge API (optional)
BUILT_IN_FORGE_API_URL=
BUILT_IN_FORGE_API_KEY=
VITE_FRONTEND_FORGE_API_KEY=
VITE_FRONTEND_FORGE_API_URL=

# Captcha solving (optional — improves Yandex scraping)
RUCAPTCHA_API_KEY=

# Residential proxies (optional — improves Yandex scraping)
PROXYLINE_API_KEY=

# Analytics (optional)
VITE_ANALYTICS_ENDPOINT=
VITE_ANALYTICS_WEBSITE_ID=
```

## Step 3 — Build and run with Docker

```bash
# Build the image
docker build -t office-rental-monitor .

# Run the container
docker run -d \
  --name office-rental-monitor \
  --restart unless-stopped \
  --env-file env.production \
  -p 3000:3000 \
  office-rental-monitor
```

Or with Docker Compose — create `docker-compose.yml`:

```yaml
version: "3.9"
services:
  app:
    build: .
    restart: unless-stopped
    env_file: env.production
    ports:
      - "3000:3000"
    volumes:
      - sessions:/app/.sessions   # Yandex session persistence
volumes:
  sessions:
```

Then run:

```bash
docker compose up -d --build
```

Database migrations run automatically on startup. No manual step needed.

## Step 4 — Nginx reverse proxy (recommended)

Install Nginx and create `/etc/nginx/sites-available/office-rental-monitor`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and add HTTPS:

```bash
ln -s /etc/nginx/sites-available/office-rental-monitor /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

## Step 5 — External cron trigger (optional)

The app exposes `POST /api/cron/run` to trigger a monitoring cycle. Add to system cron:

```bash
crontab -e
# Add:
*/30 * * * * curl -s -X POST http://localhost:3000/api/cron/run
```

## Troubleshooting

**Chromium not found:** The Dockerfile sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. If the path differs, update the env variable.

**Database SSL errors:** Timeweb managed MySQL requires SSL. The app already sets `ssl: { rejectUnauthorized: false }` in the connection pool.

**Out of memory:** Playwright + Chromium requires at least 1 GB RAM. Use a VPS plan with 2 GB or more. Reduce `maxPages` in the search config to limit browser activity.
