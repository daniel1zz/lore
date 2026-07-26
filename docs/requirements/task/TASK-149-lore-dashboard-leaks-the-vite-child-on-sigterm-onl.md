---
id: TASK-149
type: task
role: plan
title: "lore dashboard leaks the Vite child on SIGTERM — only SIGINT is handled, orphaned vite keeps the port and breaks the next run's origin allowlist"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Observed twice during SPEC-078 UAT (2026-07-25): killing the dist/lore dashboard parent via SIGTERM (pkill / kill PID) leaves the spawned vite child alive holding 5173. Next dashboard run auto-increments to 5174 where the hardcoded bootstrap Origin allowlist rejects login (compounds with task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173). dashboard.ts invariant says 'SIGINT kills Vite and stops the HTTP server' — SIGTERM (the default kill/pkill signal) has no handler.

AC:
- Given lore dashboard receives SIGTERM, Then the vite child is killed and the HTTP server stopped before exit (same teardown as SIGINT) — asserted by a bun test spawning the compiled binary, sending SIGTERM, and verifying the child pgid/port is released within a bounded window.
- Given SIGINT, Then behavior unchanged (regression).
