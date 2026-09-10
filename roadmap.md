# Roadmap — LinkedIn research readiness

Overall status: **IMPLEMENTED — REAL LINKEDIN VERIFICATION PENDING**

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| React / TanStack Start frontend | DONE | Existing application and protected routes compile. |
| Lovable + Supabase authentication | IMPLEMENTED — NOT TESTED | JWT middleware and protected route exist; no live auth session was exercised in this audit. |
| Supabase persistence schema | IMPLEMENTED — NOT TESTED | Migrations and application tests cover ownership/provenance; migration `0002` still needs deployment to a real Supabase database. |
| Search history and normalized result persistence | DONE | Authenticated-user row builders and automated tests pass. |
| Saved profiles | DONE | User-owned persistence and provenance are implemented and tested. |
| Integration health events | IMPLEMENTED — NOT TESTED | User ownership and admin visibility are defined/tested at migration level; no live database write was exercised. |
| User isolation / RLS | IMPLEMENTED — NOT TESTED | Policies are covered by automated migration assertions; live Supabase RLS integration testing remains pending. |
| Lovable LinkedIn provider | IMPLEMENTED — NOT TESTED | Capability probing and true LinkedIn provenance exist; connector credentials/capabilities are unavailable here. |
| Agent Reach provider | DONE | Mocked HTTP, timeout, malformed payload, filtering, auth and leakage tests pass. |
| Composite LinkedIn provider | DONE | Dedicated routing, fallback, terminal-error, metadata, timeout, malformed-response and filter tests pass. |
| Apollo enrichment role | DONE | Explicit Apollo provenance; excluded from the LinkedIn-search composite. |
| Local Docker deployment | IMPLEMENTED — NOT TESTED | Compose, persistent volume, health check and setup documentation exist; Docker was not started here. |
| Same-VPS deployment | IMPLEMENTED — NOT TESTED | Private-network compose and guide exist; no deployment was performed. |
| Separate-VPS deployment | IMPLEMENTED — NOT TESTED | Caddy HTTPS boundary and guide exist; no deployment was performed. |
| Agent Reach login wrapper | IMPLEMENTED — NOT TESTED | `npm run login` maps to `node src/login.js`, which spawns the configured MCP command with `--login`; the MCP binary/session is absent here. |
| Sidecar JavaScript syntax check | REAL VERIFIED | `npm run check` completed successfully on 2026-09-10. |
| Automated unit/policy tests | REAL VERIFIED | `npm test`: 4 files, 52 tests passed, 0 failed, 0 skipped on 2026-09-10. |
| TypeScript check | REAL VERIFIED | `npx tsc --noEmit` completed successfully on 2026-09-10. |
| ESLint | REAL VERIFIED | `npm run lint` completed with 0 errors and 7 pre-existing Fast Refresh warnings on 2026-09-10. |
| Production build | REAL VERIFIED | `npm run build` completed successfully on 2026-09-10; optimization/tooling warnings remain documented in the audit report. |
| Real LinkedIn search | BLOCKED | Requires configured connector or `LINKEDIN_SERVICE_URL` + `LINKEDIN_SERVICE_TOKEN`, an installed MCP server, persistent login, and a real full-flow query. |

`REAL LINKEDIN VERIFIED` must not be used until a genuine LinkedIn query returns
normalized, provenance-labelled data through the application UI and persists it
to the authenticated user's search history.
