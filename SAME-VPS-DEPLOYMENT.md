# SAME-VPS-DEPLOYMENT.md — MODE B (preferred production)

Application and sidecar run on one VPS, on a private Docker network. The
sidecar is never published to the internet.

```
Single VPS
├── app (application + backend)         :3000 (behind your reverse proxy)
├── linkedin-agent-reach                :8787 (private network only)
│   └── Agent Reach → mcporter → mcp-server-linkedin → LinkedIn
├── volume linkedin-session             (persistent LinkedIn session)
└── network linkedin-internal           (private)
```

Compose file: `services/linkedin-agent-reach/docker-compose.production.yml`.

---

## 1. Requirements

- Linux VPS you control, 2 vCPU / 4 GB RAM minimum (Chromium is memory hungry).
- Docker Engine + Compose plugin.
- Persistent disk for the Docker volume.

Serverless hosts will not work: the MCP process must stay resident and keep a
browser profile on disk.

## 2. Service token

```bash
openssl rand -hex 32
```

Store it in a root-only env file, never in Git:

```bash
cd services/linkedin-agent-reach
umask 077
printf 'LINKEDIN_SERVICE_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
```

## 3. Start both services

```bash
cd services/linkedin-agent-reach
docker compose -f docker-compose.production.yml up -d --build
```

The app waits for the sidecar's health check (`depends_on: service_healthy`)
before starting.

## 4. Sign in to LinkedIn once

```bash
docker compose -f docker-compose.production.yml exec linkedin-agent-reach npm run login
```

This runs the MCP server's supported login flow (`mcp-server-linkedin --login`).
The session is written to `/data/linkedin-profile` on the `linkedin-session`
volume and survives container restarts, app restarts, server reboots and
sidecar image updates.

Verify from inside the network:

```bash
docker compose -f docker-compose.production.yml exec app \
  curl -fsS -H "Authorization: Bearer $LINKEDIN_SERVICE_TOKEN" \
  http://linkedin-agent-reach:8787/health
```

Expect `"status": "SEARCH_SUPPORTED"`.

## 5. App configuration

Set on the `app` service (already wired in the compose file):

```
LINKEDIN_SERVICE_URL=http://linkedin-agent-reach:8787
LINKEDIN_SERVICE_TOKEN=${LINKEDIN_SERVICE_TOKEN}
LINKEDIN_SERVICE_TIMEOUT_MS=45000
```

Plain HTTP is correct here: the traffic never leaves the private Docker
network. Do **not** add a `ports:` mapping for the sidecar.

## 6. Operations

- **Restart policy**: `unless-stopped` on both services.
- **Health checks**: `/healthz` every 30 s, 40 s start period.
- **Resource limits**: sidecar capped at 2 GB / 1.5 CPU, app at 1 GB.
- **Timeouts**: sidecar MCP call timeout 60 s; app request timeout 45 s.
- **Rate limiting**: sidecar `RATE_LIMIT=30` requests/minute per client;
  the app additionally rate-limits per signed-in user.
- **Updates**: `docker compose -f docker-compose.production.yml up -d --build`
  rebuilds without touching the session volume.
- **Backups**: back up the `linkedin-session` volume if you want to avoid
  re-login after a host migration; treat the backup as a secret.

## 7. What must never happen

- Publishing port 8787 to `0.0.0.0`.
- Committing `.env`, the token, or anything from `/data`.
- Sending the token or LinkedIn cookies to the browser.
- Baking session data into the Docker image.

## 8. Troubleshooting

| Symptom | Action |
| --- | --- |
| App starts before sidecar | check the sidecar health check; `docker compose logs linkedin-agent-reach` |
| `LOGIN_REQUIRED` after weeks | LinkedIn expired the session; rerun step 4 |
| `SERVICE_OFFLINE` | MCP process crashed; check container memory limits and logs |
| Sidecar OOM-killed | raise the memory limit; Chromium needs headroom |
| `401` from the app | token drift between app env and sidecar `.env` |
