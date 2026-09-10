# Agent Reach sidecar — exact deployment steps

The sidecar owns the signed-in LinkedIn session. The Lovable app never sees
LinkedIn credentials or cookies; it only calls this service with a bearer token.

```
App (server function) --HTTPS+token--> sidecar --stdio--> mcp-server-linkedin --> LinkedIn
```

Requirements: a Linux host you control (VM or container host) with a persistent
disk, a public HTTPS hostname, Node.js 20+, and Python 3.11+ (for
`mcp-server-linkedin`). Serverless platforms will not work: the MCP process must
stay resident and keep a browser profile on disk.

---

## 1. Generate the service token

```bash
openssl rand -hex 32
```

Keep this value. It is used twice: as `LINKEDIN_SERVICE_TOKEN` on the sidecar
host and as `LINKEDIN_SERVICE_TOKEN` in the Lovable app.

## 2. Deploy the service

### Option A — Docker (recommended)

```bash
# from the repository root
cd services/linkedin-agent-reach
docker build -t linkedin-agent-reach .
docker volume create linkedin-session

docker run -d --name linkedin-agent-reach \
  -p 127.0.0.1:8787:8787 \
  -v linkedin-session:/data \
  -e LINKEDIN_SERVICE_TOKEN=<token-from-step-1> \
  --restart unless-stopped \
  linkedin-agent-reach
```

### Option B — systemd on a VM

```bash
sudo apt-get update && sudo apt-get install -y nodejs npm python3-pip
pip install --user mcp-server-linkedin
sudo mkdir -p /opt/linkedin-agent-reach /var/lib/linkedin-agent-reach
sudo cp -r services/linkedin-agent-reach/{package.json,src} /opt/linkedin-agent-reach/
```

`/etc/systemd/system/linkedin-agent-reach.service`:

```ini
[Unit]
Description=LinkedIn Agent Reach sidecar
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/linkedin-agent-reach
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=MCP_COMMAND=mcp-server-linkedin
Environment=MCP_PROFILE_DIR=/var/lib/linkedin-agent-reach/profile
Environment=LINKEDIN_SERVICE_TOKEN=<token-from-step-1>
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/linkedin-agent-reach

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now linkedin-agent-reach
```

## 3. Put TLS in front

The service must only be reachable over HTTPS. Bind it to `127.0.0.1` and
terminate TLS with Caddy (simplest) or nginx:

```
linkedin.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Verify liveness (no token, no LinkedIn data returned):

```bash
curl -fsS https://linkedin.example.com/healthz
# {"ok":true,"service":"linkedin-agent-reach"}
```

## 4. Complete the LinkedIn login

This step is interactive and must run on the sidecar host, in the same profile
directory the service uses.

Docker:

```bash
docker exec -it linkedin-agent-reach mcp-server-linkedin --login
```

systemd/VM:

```bash
sudo -u <service-user> MCP_PROFILE_DIR=/var/lib/linkedin-agent-reach/profile \
  mcp-server-linkedin --login
# or, from the repo copy:
node /opt/linkedin-agent-reach/src/login.js
```

Complete the LinkedIn browser sign-in (including any 2FA/checkpoint) in the
window or device-code prompt it opens. On a headless host, forward the browser
with `ssh -L` or use the printed URL from a desktop machine. The session is
persisted in `MCP_PROFILE_DIR`; keep that volume — otherwise every restart needs
another login.

Restart the service afterwards so it reconnects with the signed-in session:

```bash
docker restart linkedin-agent-reach   # or: sudo systemctl restart linkedin-agent-reach
```

## 5. Confirm capability

```bash
curl -fsS -H "Authorization: Bearer <token>" https://linkedin.example.com/health
```

Expect `"status": "SEARCH_SUPPORTED"` with `connected: true`,
`authenticated: true`, and a non-empty `capabilities` array. Any other status
means the chain is not ready — see the status table in `README.md`.

## 6. Configure the Lovable app

Set these two project secrets in the Lovable app (Project settings → secrets):

| Variable | Value |
| --- | --- |
| `LINKEDIN_SERVICE_URL` | `https://linkedin.example.com` (no trailing slash) |
| `LINKEDIN_SERVICE_TOKEN` | the token from step 1 |

Optional: `LINKEDIN_SERVICE_TIMEOUT_MS` (default `45000`).

The app reads these inside server functions only. They are never exposed to the
browser.

## 7. End-to-end verification

1. Sign in to the app with a confirmed account.
2. Open **/linkedin-search** (protected route).
3. The status card must read ready / search supported.
4. Run one real search (for example people, keywords `product manager`,
   location `Cairo`).
5. Confirm results render and that a row was recorded in `linkedin_searches`
   with `backend = "mcp-server-linkedin"` and `result_count > 0`.

Only after step 5 passes may the project status change to
**REAL LINKEDIN VERIFIED**.

## Operational notes

- **Session expiry:** LinkedIn invalidates sessions periodically. `/health` then
  reports `LOGIN_REQUIRED`; repeat step 4.
- **Rate limits:** the sidecar caps requests per IP (`RATE_LIMIT`, default 30/min)
  and the app caps per user. LinkedIn's own limits are stricter — keep volumes low.
- **Rotation:** change `LINKEDIN_SERVICE_TOKEN` on the host and in the app
  together; the service refuses to start with a token under 32 characters.
- **Logs:** the sidecar never logs the token, cookies, or upstream response
  bodies. Keep it that way.
