# LinkedIn runtime architecture

Verified against the repository on 2026-09-10.

## Application layer

- **Frontend:** React 19 with TanStack Start/Router and TanStack Query. The public
  landing page is `/`; authenticated search is `/linkedin-search`.
- **Authentication:** Lovable/Supabase Auth provides the browser session.
  `requireSupabaseAuth` validates the bearer JWT and injects the authenticated
  `userId` and a user-scoped Supabase client into every LinkedIn server function.
- **Database:** Supabase Postgres stores searches, normalized results, saved
  profiles, provider provenance, and integration events. RLS binds records to
  `auth.uid()`. Integration diagnostics additionally permit admin reads through
  `user_roles` and `has_role`; the mutable `profiles.role` field is not an
  authorization source.
- **Server functions:** status, search, profile retrieval, save, history, and
  diagnostics live in `src/lib/linkedin/linkedin.functions.ts`. Search and
  persistence are server-side; provider credentials are never sent to the UI.
- **Protected routes:** the `_authenticated` layout requires a current Supabase
  user. The diagnostics server function also requires the `admin` role.

## LinkedIn research layer

`LinkedInProvider` is the stable contract for health, capability discovery,
people/company/job search, and profile detail. Each provider declares its data
source and whether it is truly LinkedIn-sourced. Every normalized result and
search response includes `provider`, `source`, `isLinkedInSourced`,
`retrievedAt`, and the compatibility timestamp `retrieved_at`; persistence keeps
the equivalent columns.

Routing for LinkedIn search is:

```text
LinkedIn search intent
  -> Lovable LinkedIn connector, when configured and capability-supported
  -> Agent Reach sidecar, only for safe fallback states
  -> explicit error when no LinkedIn-capable provider can answer
```

- **Lovable LinkedIn provider:** calls the server-side Lovable connector gateway,
  verifies authentication, probes real capabilities, and only forwards declared
  filters.
- **Agent Reach provider:** calls the authenticated HTTP sidecar and normalizes
  MCP output as LinkedIn-sourced data.
- **Apollo provider:** optional third-party enrichment/professional data. It is
  created for independent diagnostics but is excluded from the LinkedIn search
  composite. Apollo records remain labelled `source: apollo` and
  `isLinkedInSourced: false`.
- **Composite routing:** checks live capability declarations and prunes filters
  before each call. Unsupported, unavailable, timeout, and malformed-response
  states may advance to the next LinkedIn provider. Authentication required,
  permission denied, account restricted, configuration error, and rate limiting
  are terminal and never silently fall back.

## Agent Reach sidecar

```text
Application
  -> server-side AgentReachLinkedInProvider
  -> Agent Reach HTTP sidecar
  -> MCP stdio client
  -> mcp-server-linkedin
  -> LinkedIn
```

### Configuration

Application-side variables:

- `LINKEDIN_SERVICE_URL`: sidecar origin. Use HTTPS across hosts; same-VPS Docker
  may use the private service URL.
- `LINKEDIN_SERVICE_TOKEN`: shared bearer token, server-side only.
- `LINKEDIN_SERVICE_TIMEOUT_MS`: optional application request timeout.
- `LOVABLE_API_KEY` and `LINKEDIN_API_KEY`: required only for the Lovable
  LinkedIn connector.

Sidecar variables:

- `LINKEDIN_SERVICE_TOKEN` (required, at least 32 characters)
- `PORT`, `HOST`, `RATE_LIMIT`
- `MCP_COMMAND`, `MCP_ARGS`, `MCP_CWD`, `MCP_REQUEST_TIMEOUT_MS`
- `MCP_PROFILE_DIR` is set to `/data/linkedin-profile` in the image.

### Endpoints and capability detection

- `GET /healthz` is public liveness only and discloses no session state.
- Authenticated `GET /health` and `GET /status` report installed/running,
  authenticated state, discovered MCP tools, supported search capabilities, and
  supported filters.
- Authenticated `POST /search` and `POST /profile` invoke discovered MCP tools.
  Undeclared tools and filters are never presented as supported.

A successful `/healthz`, or even an HTTP 200 from `/health`, is **not proof that
real LinkedIn search works**. Only an actual successful query through the full
application flow returning normalized real data verifies the integration.

### Authentication, sessions, and transport

The sidecar compares bearer tokens in constant time. LinkedIn login is
interactive: from `services/linkedin-agent-reach`, `npm run login` executes
`node src/login.js`, which launches the configured MCP command with `--login`.
The browser session remains in the persistent `/data` volume and is excluded
from Git. The login helper and MCP client do not print command arguments,
cookies, upstream bodies, or raw provider errors.

Local Docker publishes the sidecar for development. Same-VPS production keeps
it on a private Docker network. Separate-VPS deployment exposes Caddy on
80/443, keeps the sidecar port private, and terminates HTTPS at Caddy. Never send
the bearer token across an untrusted plaintext network.

### Timeouts and failures

The application and MCP client apply bounded timeouts; Caddy uses bounded dial
and response-header timeouts. Failure states are distinct:

- authentication required
- permission denied
- account restricted
- configuration error
- rate limited
- timeout
- capability unsupported
- backend unavailable
- invalid/malformed response

Raw upstream response bodies are not returned to the frontend or copied into
sidecar logs.

## End-to-end verification path

```text
User -> LinkedIn Search UI -> authenticated server function
  -> CompositeLinkedInProvider -> LinkedIn-capable provider
  -> Agent Reach sidecar when selected -> mcp-server-linkedin -> LinkedIn
  -> normalized provenance-labelled data -> UI
  -> user-owned search history and result persistence
```

Repository inspection found no configured sidecar URL/token, connector keys,
local sidecar environment file, installed `mcp-server-linkedin` command, or live
LinkedIn session in this environment. The code is implemented, but the status
therefore remains **IMPLEMENTED — REAL LINKEDIN VERIFICATION PENDING**.
