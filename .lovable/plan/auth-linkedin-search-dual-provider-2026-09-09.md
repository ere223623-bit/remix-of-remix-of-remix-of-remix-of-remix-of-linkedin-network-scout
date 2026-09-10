# Auth + LinkedIn Search (dual-provider)

## Goal
Add user authentication with profiles, then a premium LinkedIn search and research tool that prefers the Lovable LinkedIn connector and falls back to the existing Agent Reach sidecar.

## Database

1. `public.profiles` table
   - `user_id uuid primary key references auth.users(id) on delete cascade`
   - `display_name text`, `avatar_url text`, `job_title text`, `company text`
   - `role app_role not null default 'user'`
   - `preferences jsonb not null default '{}'`
   - `created_at`, `updated_at timestamptz`
   - GRANTs, RLS, policies: users read/update own profile; admins read all.
2. Trigger to auto-create profile on `auth.users` insert.
3. Regenerate Supabase types.

## Authentication

1. Public `/auth` route: email/password sign-in and sign-up, Google OAuth via `lovable.auth.signInWithOAuth`, "check your email" confirmation state.
2. Public `/reset-password` route for recovery links.
3. Session-aware root header with sign-in / account menu / sign-out.
4. Sign-out hygiene: cancel queries, clear cache, sign out, navigate to `/auth` with `replace: true`.
5. Protected layout under `src/routes/_authenticated/route.tsx` (integration-managed pattern, `ssr: false`, redirect to `/auth`).
6. Configure Google social auth (and keep email enabled for now since password auth is used).

## LinkedIn provider architecture

1. Extend `LinkedInProvider` interface to expose `provider` label and health/capabilities.
2. Create `LovableLinkedInProvider`:
   - Calls `https://connector-gateway.lovable.dev/linkedin/{path}`.
   - Sends `Authorization: Bearer ${LOVABLE_API_KEY}` and `X-Connection-Api-Key: ${LINKEDIN_API_KEY}`.
   - Health/capabilities via gateway introspection or a lightweight probe.
   - Search attempts use documented LinkedIn API paths; unsupported responses bubble as `unsupported` so the selector can fall back.
   - Never leaks credentials.
3. Keep `AgentReachLinkedInProvider` intact.
4. Create `CompositeLinkedInProvider`:
   - Tries Lovable connector first if connected + healthy + capable.
   - Falls back to Agent Reach when connector unavailable, unconnected, or unsupported.
   - Does not fall back on auth/permission errors; surfaces those to the user.
   - Records `provider` (`lovable_connector` | `agent_reach`) on every result.
5. Add `/api/integrations/linkedin/status` and `/api/linkedin/search` server functions/routes with Zod validation, rate limiting, and provider tracking.

## Frontend

1. Premium SaaS shell: left sidebar, global search, clean light interface, blue/indigo accents, rounded cards, status indicators.
2. `/linkedin-search` — search bar, People/Companies/Jobs tabs, filters pruned by backend capability, card/list/table views, export CSV/JSON.
3. `/linkedin-search/profile/$id` — profile detail: Overview, Current Position, Experience, Education, Skills, About, Source Information.
4. `/linkedin-search/history` — past searches, re-run, delete.
5. `/linkedin-search/saved` — saved profiles with company/location/title/tag filters and notes.
6. `/admin/integrations/linkedin` — provider status, health check, capabilities, last error, average response time.

## Tests

- Vitest for provider selection logic, normalization, error mapping, empty results, rate limiting, timeout, malformed responses.

## Build order

1. Migration: profiles table + trigger + RLS.
2. Auth routes and session-aware shell.
3. Lovable connector provider + composite selector.
4. LinkedIn server functions and API routes.
5. Search UI and results views.
6. Profile, history, saved, admin diagnostics.
7. Tests.
