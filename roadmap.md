# Roadmap — Agent Reach deployability + first real LinkedIn search

- [x] Mode A: local Docker compose file, Windows-friendly token generation, persistent session volume
- [x] Secure tunnel documentation (Cloudflare Tunnel primary, ngrok optional)
- [x] Mode B: same-VPS compose with private network, health checks, limits
- [x] Mode C: separate VPS with Caddy HTTPS termination + hardening
- [x] Mode D: capability-based composite provider selection + safe fallback rules
- [x] Sidecar `/health` structured status + capabilities (runtime-verified only)
- [x] Admin diagnostics: separate connector / sidecar cards, health check + refresh actions
- [x] Automated tests (mocked upstream) for selection, fallback, errors, normalization, health
- [x] Documentation set: runtime architecture + three deployment guides
- [ ] BLOCKED ON USER: run the sidecar locally, complete LinkedIn login, share tunnel URL + token → then REAL LINKEDIN VERIFIED
