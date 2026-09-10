# linkedin-agent-reach

Authenticated HTTP sidecar that exposes a signed-in `mcp-server-linkedin`
session to the app over a stable contract. Zero npm dependencies; runs with
`node src/server.js` on Node 20+.

Deployment instructions: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | none | Liveness only. Returns `{ ok: true }`, no LinkedIn or session data. |
| GET | `/health` | Bearer token | Full capability/status report. |
| GET | `/status` | Bearer token | Alias of `/health`. |
| POST | `/search` | Bearer token | `{ type, query, filters, limit }` → normalized results. |
| POST | `/profile` | Bearer token | `{ profile_url }` → one normalized profile. |

Auth is a constant-time comparison against `LINKEDIN_SERVICE_TOKEN`. Requests
without it get `401` and never reach the MCP process.

## Status model

`/health` returns exactly one `status`, plus explicit booleans so the app never
has to infer the reason:

| `status` | `connected` | `authenticated` | `search_supported` | Meaning / action |
| --- | --- | --- | --- | --- |
| `SERVICE_OFFLINE` | false | false | false | MCP process not running. Check the service and its logs. |
| `LOGIN_REQUIRED` | true | false | false | Running but not signed in. Run `mcp-server-linkedin --login` on the host. |
| `SEARCH_UNAVAILABLE` | true | true | false | Signed in, but no usable search tool is exposed. |
| `SEARCH_SUPPORTED` | true | true | true | Ready — real searches can run. |

Companion fields: `available`, `capabilities`, `supported_filters`,
`agent_reach_installed`, `agent_reach_version`, `detected_tools`, `message`,
`checked_at`.

Search failures map onto the app's error codes: `LINKEDIN_AUTH_REQUIRED` (401),
`LINKEDIN_RATE_LIMITED` (429), `LINKEDIN_TIMEOUT` (504),
`LINKEDIN_BACKEND_UNAVAILABLE` (502/503).

## Environment

See [`.env.example`](./.env.example). Required: `LINKEDIN_SERVICE_TOKEN`
(≥32 chars — the service refuses to start otherwise).

## Guarantees

- No LinkedIn credentials or cookies cross the HTTP boundary.
- No result is ever synthesized; missing source fields are omitted so the app
  records them as `null`.
- Upstream error bodies are mapped to codes, never forwarded verbatim.
