# LOCAL-LINKEDIN-SETUP.md — MODE A (development / verification only)

> **DEVELOPMENT / VERIFICATION ONLY.** This mode exposes a machine you own
> through a temporary tunnel. Do not use it as production infrastructure.

```
Lovable app  →  HTTPS  →  secure tunnel  →  localhost:8787
                                            └─ Docker: linkedin-agent-reach
                                               └─ Agent Reach → mcporter → mcp-server-linkedin → LinkedIn
```

Everything here runs on your Windows machine. The LinkedIn session never
leaves it; the app only ever receives normalized search results.

---

## 0. Prerequisites

- Docker Desktop for Windows (WSL2 backend), running.
- PowerShell.
- A LinkedIn account you are allowed to use for professional search.

---

## 1. Generate the service token

The token authenticates the app to the sidecar. 64 hex characters.

PowerShell (no OpenSSL needed):

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

No Python? Pure PowerShell:

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Minimum 0 -Maximum 256) })
```

Git Bash / WSL:

```bash
openssl rand -hex 32
```

Copy the value. It is used in exactly two places: the sidecar `.env` and the
app secret `LINKEDIN_SERVICE_TOKEN`. **Never commit it.** `.env` files under
`services/linkedin-agent-reach/` are git-ignored and docker-ignored.

---

## 2. Create the sidecar `.env`

```powershell
cd services\linkedin-agent-reach
copy .env.example .env
notepad .env
```

Set at minimum:

```
LINKEDIN_SERVICE_TOKEN=<the 64-char token from step 1>
```

The service refuses to start if the token is missing or shorter than 32 chars.

---

## 3. Start the sidecar

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

Liveness (no auth, returns no LinkedIn data):

```powershell
curl http://127.0.0.1:8787/healthz
```

Full status (auth required):

```powershell
curl -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:8787/health
```

At this point expect `"status": "LOGIN_REQUIRED"` — correct, you have not
signed in yet.

---

## 4. Sign in to LinkedIn

The sidecar's login helper (`services/linkedin-agent-reach/src/login.js`, run by
`npm run login`) launches the MCP server's own login flow:
`mcp-server-linkedin --login`, attached to your terminal.

Run it **inside the container** so the session is written to the persistent
volume:

```powershell
docker compose -f docker-compose.local.yml exec linkedin-agent-reach npm run login
```

Follow the prompts in the terminal. If your LinkedIn account requires a
verification code or shows a challenge, complete it yourself — the project does
not automate credential entry and does not bypass challenges.

The session is stored in `MCP_PROFILE_DIR=/data/linkedin-profile`, which is the
named Docker volume `linkedin-session`. It survives `docker compose restart`,
`down`, rebuilds and machine reboots. Removing the volume
(`docker volume rm linkedin-session`) is what forces a fresh login.

Verify:

```powershell
docker compose -f docker-compose.local.yml restart
curl -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:8787/health
```

You want:

```json
{ "status": "SEARCH_SUPPORTED", "authenticated": true, "search_supported": true,
  "capabilities": ["profile_search", "..."] }
```

`capabilities` is derived from the tools the running MCP process actually
exposes — nothing is assumed from documentation.

---

## 5. Open a secure tunnel

### Cloudflare Tunnel (recommended)

Quick tunnel, no account needed, URL changes on each run:

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8787
```

It prints `https://<random>.trycloudflare.com`. That is your
`LINKEDIN_SERVICE_URL`.

Named tunnel (stable hostname, requires a Cloudflare account and a domain):

```powershell
cloudflared tunnel login
cloudflared tunnel create linkedin-sidecar
cloudflared tunnel route dns linkedin-sidecar linkedin-dev.example.com
cloudflared tunnel run --url http://localhost:8787 linkedin-sidecar
```

### ngrok (optional alternative)

```powershell
winget install ngrok.ngrok
ngrok config add-authtoken <your-ngrok-token>
ngrok http 8787
```

Use the `https://` forwarding URL.

Confirm the tunnel reaches the sidecar:

```powershell
curl https://<tunnel-host>/healthz
```

---

## 6. Point the app at the tunnel

Give these two values to the app as **server-side secrets** (never as
`VITE_`-prefixed variables, never in frontend code):

```
LINKEDIN_SERVICE_URL=https://<tunnel-host>
LINKEDIN_SERVICE_TOKEN=<the same token>
```

Optional: `LINKEDIN_SERVICE_TIMEOUT_MS=45000`.

---

## 7. Verify a real search

1. Sign in to the app.
2. Open the protected LinkedIn search page.
3. Open **LinkedIn diagnostics** and press **Run health check** — the Agent
   Reach card should read reachable, authenticated, people search supported.
4. Run a simple professional query, e.g. `Software Engineer` / location
   `Saudi Arabia`, limit 10.
5. Results should render, search history should record the query, and the
   recorded provider should be `agent-reach`.
6. In the browser devtools network tab, no response should contain the service
   token, LinkedIn cookies, or session paths.

Only after real results appear end to end is the status **REAL LINKEDIN
VERIFIED**.

---

## Troubleshooting

| Symptom | Meaning | Action |
| --- | --- | --- |
| `/healthz` fails | container down | `docker compose -f docker-compose.local.yml logs -f` |
| `status: SERVICE_OFFLINE` | MCP process not spawning | check `MCP_COMMAND`; view container logs |
| `status: LOGIN_REQUIRED` | not signed in / session expired | rerun step 4 |
| `status: SEARCH_UNAVAILABLE` | signed in, backend exposes no search tool | check `detected_tools` in `/health`; update `mcp-server-linkedin` |
| `401` from the app | token mismatch | the app secret and sidecar `.env` must match exactly |
| Tunnel 502 | tunnel up, container down | restart the container |
| Session lost after reboot | volume removed | do not `docker compose down -v` |
