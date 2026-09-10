# Credential and session rotation note

Audit date: 2026-09-10

The formerly tracked root `.env` contained a real Supabase project URL, project
identifier, and publishable/anonymous client key. These values are intended for
browser delivery and are not privileged secrets. The file did **not** contain a
Supabase service-role key, LinkedIn credential or cookie, Agent Reach service
token, password, private key, or refresh token.

The root `.env` has been removed from Git tracking and all root environment
variants are now ignored except `.env.example`. It was introduced by one commit
and remains reachable in the snapshots of nine existing commits. Published
history has deliberately not been rewritten,
because this repository is connected to Lovable and rewriting published history
can destroy Lovable project history.

## Rotation decision

- Supabase publishable/anonymous client key: rotation is **not required solely
  because of this exposure**; it is a public client credential and security must
  be enforced by RLS. Rotate it if the project owner has an independent reason
  to invalidate existing clients.
- Supabase service-role key: not found; no rotation required from this audit.
- `LINKEDIN_SERVICE_TOKEN`: not found in tracked content or history inspected;
  no rotation required from this audit. If it was ever shared elsewhere, rotate
  it on both the application and sidecar at the same time.
- LinkedIn session/cookies: not found in tracked content or history inspected;
  no rotation required from this audit. If session data was ever copied outside
  the ignored persistent volume, revoke LinkedIn sessions and log in again.
- Lovable and LinkedIn connector keys: not found in the tracked root environment
  inspected; no rotation required from this audit.

Do not add real values to `.env.example` or documentation. Never store `li_at`,
`JSESSIONID`, browser profile directories, or sidecar bearer tokens in Git.
