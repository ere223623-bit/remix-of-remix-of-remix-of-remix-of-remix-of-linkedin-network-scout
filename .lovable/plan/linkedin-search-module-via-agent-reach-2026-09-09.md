# LinkedIn Search module via Agent Reach

## What I found

**This project** is currently an empty starter: a React + TanStack Start app (Vite, Tailwind, shadcn components available), one placeholder home page, no backend logic, no database, no login, no secrets configured. Server code runs on Cloudflare Workers.

**Agent Reach** (Panniantong/Agent-Reach) is a Python command-line tool. It does not scrape LinkedIn itself — it installs and health-checks an upstream LinkedIn tool (`mcp-server-linkedin`, browser automation) and falls back to Jina Reader for public pages. LinkedIn access requires a real browser login session stored on the machine that runs it. Its own docs warn that `agent-reach doctor` only confirms configuration, not live connectivity.

**The hard constraint:** Cloudflare Workers cannot run Python, a CLI, or a logged-in browser. So Agent Reach can never run inside this app's server. It must run as a separate service you host (your own machine, VPS, or container) and this app talks to it over HTTPS.

## Architecture

```text
React UI (/linkedin-search)
   -> app server functions (TanStack, same origin, auth-protected)
      -> LinkedInProvider interface
         -> AgentReachLinkedInProvider  --HTTPS + shared secret-->  Python FastAPI sidecar
                                                                      -> Agent Reach / mcp-server-linkedin
      -> normalized results -> Lovable Cloud database -> results UI
```

The sidecar URL and shared token live in server-side secrets only. No LinkedIn cookie, session, or Agent Reach config ever reaches the browser.

## What I will build

**Sidecar (delivered as code + README in `services/linkedin-agent-reach/`, run by you)**
- FastAPI app with `/health`, `/capabilities`, `/search`, `/profile`.
- Calls Agent Reach / the LinkedIn MCP server, runs `agent-reach doctor --json`, reports real detected capabilities and auth state — never fabricated.
- Bearer-token auth, timeouts, request size limits, error sanitising, no cookie logging.
- Dockerfile + setup instructions (`pipx install ...`, `agent-reach install --channels=linkedin`, `uvx mcp-server-linkedin@latest --login`).

**App backend (TanStack server functions + routes)**
- `LinkedInProvider` interface: `searchPeople`, `searchCompanies`, `searchJobs`, `getProfile`, `healthCheck`, `getCapabilities`.
- `AgentReachLinkedInProvider` implementation talking to the sidecar.
- `POST /api/linkedin/search` and `GET /api/integrations/linkedin/status` in the documented response shapes.
- Zod validation, per-user rate limiting, timeouts, states `READY / AUTH_REQUIRED / BACKEND_UNAVAILABLE / RATE_LIMITED / TIMEOUT / CONFIGURATION_ERROR`. Upstream failure is surfaced as an error, never as empty results.

**Lovable Cloud** (database + login, enabled as part of this work)
- Tables: `linkedin_searches` (history), `linkedin_saved_profiles` (notes, tags, favourite), `linkedin_result_cache`, `user_roles` (for the admin page). Row-level security so each person sees only their own data. No LinkedIn credentials stored in these tables.

**Frontend pages**
- `/linkedin-search` — search bar, People / Companies / Jobs tabs, advanced filters. Filters and tabs the live backend does not support are disabled with a clear note; unsupported modes show "Not supported by the currently configured LinkedIn backend."
- Card view, list view, table view, incremental loading, CSV/JSON export.
- `/linkedin-search/profile/:id` — Overview, Current Position, Experience, Education, Skills, About, Source Information. Only retrieved data, clearly labelled SOURCE DATA. No AI-generated profile fields.
- `/linkedin-search/history` — view, re-run, delete.
- Saved profiles with filtering by company, location, job title, tags.
- `/admin/integrations/linkedin` — install state, version, backend, auth status, capabilities, last success, last error, average response time, Run Health Check button.

**Tests** (Vitest) for validation, normalization, the provider adapter, empty results, auth failure, timeout, backend unavailable, rate limiting, and malformed responses — all with the LinkedIn calls mocked, no real account needed.

**Docs**: `LINKEDIN-AGENT-REACH-IMPLEMENTATION.md` with architecture, files changed, install steps, environment variables, detected backend, capabilities, endpoints, security controls, tests, limitations, deployment requirements.

## Honest limitation

I cannot install Agent Reach, log into LinkedIn, or run a real search from here — this environment has no persistent browser session and no LinkedIn account, and automating a LinkedIn login is explicitly out of scope. Until you run the sidecar and complete `mcp-server-linkedin --login`, the app will correctly report `BACKEND_UNAVAILABLE` / `AUTH_REQUIRED` and return no results rather than fake ones. The module will therefore be marked **IMPLEMENTED — REAL LINKEDIN VERIFICATION PENDING** until you confirm a live search.

## Build order

1. Enable Lovable Cloud, create tables and login.
2. Provider interface, Agent Reach adapter, API endpoints, validation and resilience.
3. Sidecar service code and its README.
4. Search page, results views, profile page, history, saved profiles, export.
5. Admin diagnostics page.
6. Tests, then the implementation document.
