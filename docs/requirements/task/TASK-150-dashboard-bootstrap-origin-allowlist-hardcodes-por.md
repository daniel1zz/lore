---
id: TASK-150
type: task
role: plan
title: "Dashboard bootstrap Origin allowlist hardcodes port 5173 — any non-default Vite port (auto-increment or --dashboard-port) gets 403 and a fully unauthenticated dashboard"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Found during SPEC-078 two-project UAT (2026-07-25, compiled dist/lore dashboard --no-open): a stale vite process held 5173, Vite auto-incremented to 5174, page loaded but POST /api/auth/local-bootstrap returned 403 (Origin http://localhost:5174 not in auth.ts ALLOWED_ORIGINS, hardcoded 5173/8787 since SPEC-016 §3.2) so the cookie was never minted and every subsequent /api/* call 401'd — switcher shows 'Project registry error: Invalid or missing API key'. Defect class: CLI surface (--dashboard-port, Vite auto-increment) diverged from the static auth allowlist.

AC:
- Given lore dashboard runs with any --dashboard-port P (or Vite lands on an auto-incremented port that the CLI KNOWS), When the SPA posts /api/auth/local-bootstrap from http://localhost:P or http://127.0.0.1:P, Then 200 + cookie minted — origin allowlist derives from the actual configured/detected port, not a constant; asserted by a unit test on the allowlist builder + an http bun test on the bootstrap route with a non-5173 origin.
- Given a genuinely foreign origin (e.g. http://evil.example), Then still 403 (negative control).
- Given the default 5173/8787 setup, Then behavior byte-identical (regression).
