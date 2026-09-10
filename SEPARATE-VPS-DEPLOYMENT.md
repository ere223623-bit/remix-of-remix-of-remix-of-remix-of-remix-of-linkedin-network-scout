# SEPARATE-VPS-DEPLOYMENT.md — MODE C

The application stays where it runs today; Agent Reach runs on its own VPS
behind HTTPS. The app calls it **server-side only**.

```
App (server function)
  → HTTPS → Caddy (or nginx) on the Agent Reach VPS
          → linkedin-agent-reach (private network, never public)
            → Agent Reach → mcporter → mcp-server-linkedin → LinkedIn
```

Compose file: `services/linkedin-agent-reach/docker-compose.separate-vps.yml`
Proxy config: `services/linkedin-agent-reach/deploy/Caddyfile`

---

## 1. Provision

- Linux VPS, 2 vCPU / 4 GB RAM minimum, persistent disk.
- Docker Engine + Compose plugin.
- A DNS `A`/`AAAA` record, e.g. `linkedin-api.example.com`, pointing at the VPS.
- Firewall: allow only 80 and 443 inbound (plus your SSH access). Never open
  8787.

```bash
ufw default deny incoming
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## 2. Copy the service and configure

```bash
git clone <your repo> app && cd app/services/linkedin-agent-reach
umask 077
cat > .env <<EOF
LINKEDIN_SERVICE_TOKEN=$(openssl rand -hex 32)
SIDECAR_DOMAIN=linkedin-api.example.com
EOF
cat .env   # copy the token; you will paste it into the app secrets
```

## 3. Start

```bash
docker compose -f docker-compose.separate-vps.yml up -d --build
```

Caddy obtains and renews a Let's Encrypt certificate automatically for
`SIDECAR_DOMAIN`. The sidecar container has no published ports — only Caddy
can reach it over the `edge` network.

Check:

```bash
curl https://linkedin-api.example.com/healthz
curl -H "Authorization: Bearer <TOKEN>" https://linkedin-api.example.com/health
```

### nginx alternative

If you prefer nginx, terminate TLS with certbot and proxy the same five paths
(`/healthz`, `/health`, `/status`, `/search`, `/profile`) to
`http://linkedin-agent-reach:8787`, with `client_max_body_size 64k;`,
`proxy_read_timeout 90s;` and a `limit_req` zone. Reject every other path.

## 4. Sign in to LinkedIn

```bash
docker compose -f docker-compose.separate-vps.yml exec linkedin-agent-reach npm run login
```

Uses the MCP server's supported login flow (`mcp-server-linkedin --login`).
Session persists in the `linkedin-session` volume at `/data/linkedin-profile`.

## 5. Configure the app

Server-side secrets only:

```
LINKEDIN_SERVICE_URL=https://linkedin-api.example.com
LINKEDIN_SERVICE_TOKEN=<the token from step 2>
LINKEDIN_SERVICE_TIMEOUT_MS=45000
```

Never expose these with a `VITE_` prefix, and never call the sidecar from the
browser.

## 6. Security posture

| Control | Where |
| --- | --- |
| Bearer-token auth, constant-time compare | sidecar, every endpoint except `/healthz` |
| Request size limit (64 KB) | sidecar + Caddy `request_body max_size` |
| Rate limiting (30 req/min per client) | sidecar `RATE_LIMIT` |
| Request timeouts (60 s MCP, 90 s server) | sidecar |
| TLS termination, HSTS, nosniff | Caddy |
| Path allowlist, 404 on anything else | Caddy |
| No raw container exposure | no published ports on the sidecar |
| Safe errors | sidecar maps upstream failures to fixed codes; upstream bodies are never forwarded |

The sidecar never returns LinkedIn cookies, session files, tokens, MCP
configuration, or Agent Reach credentials — only normalized results and the
status report.

## 7. Monitoring

- Uptime probe: `GET /healthz` (public, no data).
- Authenticated probe from your monitoring host: `GET /health`, alert when
  `status` is not `SEARCH_SUPPORTED`.
- Admin diagnostics page in the app shows reachability, response time, last
  health check, last successful search and last error.

## 8. Troubleshooting

| Symptom | Action |
| --- | --- |
| Certificate not issued | DNS not pointing at the VPS, or 80/443 blocked |
| `502` from Caddy | sidecar unhealthy: `docker compose logs linkedin-agent-reach` |
| `401` from the app | token mismatch between app secret and `.env` |
| `429` | sidecar rate limit; lower search volume or raise `RATE_LIMIT` |
| `LOGIN_REQUIRED` | rerun step 4 |
