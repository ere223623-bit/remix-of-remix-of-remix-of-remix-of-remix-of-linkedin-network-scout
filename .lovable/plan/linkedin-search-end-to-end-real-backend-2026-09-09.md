# LinkedIn Search — end-to-end real backend

## Goal
Get a signed-in user from login to real LinkedIn results in the app. The Lovable LinkedIn connector is the primary provider; the existing Agent Reach sidecar stays as fallback. No mock data is used to claim the feature works.

## Current state
- Auth, protected routes, profiles, and LinkedIn module tables are migrated.
- `AgentReachLinkedInProvider` exists and talks to a self-hosted sidecar.
- LinkedIn connector is linked; `LINKEDIN_API_KEY` is available. `LOVABLE_API_KEY` must be present for gateway calls.
- Search UI is a placeholder.

## Build steps

### 1. Provider layer
- Extend `LinkedInProvider` with `label` and a capabilities health shape.
- Create `LovableLinkedInProvider` calling `https://connector-gateway.lovable.dev/linkedin/{path}` with `Authorization: Bearer ${LOVABLE_API_KEY}` and `X-Connection-Api-Key: ${LINKEDIN_API_KEY}`.
- Probe available endpoints to detect capability (`v2/userinfo` for auth, then documented search/profile paths). Return `unsupported` for anything the gateway cannot satisfy.
- Keep `AgentReachLinkedInProvider` untouched.
- Create `CompositeLinkedInProvider` that:
  - Tries Lovable connector first if healthy and capable.
  - Falls back to Agent Reach on unavailable/unsupported.
  - Surfaces auth/permission/rate-limit errors instead of falling back.
  - Records which provider answered on every result.

### 2. Server functions and API
- `getLinkedInStatus`: returns merged provider status, last check, capabilities, supported filters.
- `searchLinkedIn`: authenticated, validates input with Zod, rate-limits per user, runs composite provider, persists `linkedin_searches` + `linkedin_results`, returns normalized response.
- `getLinkedInProfile`: fetch normalized profile detail from cache or provider.
- Record integration events for admin diagnostics.

### 3. Frontend — LinkedIn Search page
- Tabs: People / Companies / Jobs.
- Search bar + filters pruned by backend capability.
- Result cards with source and retrieved-at labels.
- Empty/error states that say exactly what failed.
- Save result action writing to `linkedin_saved_profiles`.
- History sidebar or panel listing past searches.

### 4. Wiring
- Use `useServerFn` + `useQuery`/`useMutation` from the search page.
- Ensure `attachSupabaseAuth` middleware sends the bearer token.
- Run a real search end-to-end and inspect real returned data.

### 5. Verification and honest status
- Run at least one real search with a simple query (e.g. a common company or job title) and confirm normalized results render.
- If the gateway returns unsupported scopes, auth errors, or the Agent Reach sidecar is not running, the feature ships as **IMPLEMENTED — REAL LINKEDIN VERIFICATION PENDING** with a clear message in the UI and docs.

## Out of this milestone
- Profile detail page, saved-profiles filters, CSV/JSON export, admin diagnostics page, full test suite, UI polish. These follow once the core real search flow works.

## Risks
- The linked LinkedIn connection has scopes `openid,profile,email,w_member_social`. Search APIs may require additional scopes; the provider must detect this and fall back cleanly.
- `LOVABLE_API_KEY` must be available; if missing, rotate or check project secrets.
- Agent Reach sidecar is user-hosted; if not configured, fallback is unavailable.
