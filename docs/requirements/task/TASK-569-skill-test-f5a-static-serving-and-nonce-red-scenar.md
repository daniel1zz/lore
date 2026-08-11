---
id: TASK-569
type: task
role: plan
title: "[Skill:test] F5a static serving and nonce RED scenarios"
status: archived
priority: high
phase: "Phase 2: HTTP serving & auth"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-585, type: blocks}
---
Estimate: S
Source: AC of the paired impl task (static serving + nonce), spec DD-2/DD-3/DD-4, AC-F5A-3/4/7
TDD-Role: red | Paired-Impl: static serving + nonce + allowlist
Dimensions: D-FUNC, D-SEC

Scenarios (integration, packages/lore/tests/integration/static-serving.bun.test.ts, fixture manifest injected via loader seam — never requires a real vite build):
- route priority: Given the server with static serving enabled, When GET /api/definitely-not-a-route, Then JSON 404 with code NOT_FOUND — body is JSON, never HTML. When GET /library and GET /p/alpha/library, Then 200 with index.html bytes. When GET a hashed asset path, Then 200 with Cache-Control containing immutable; index.html answers Cache-Control no-cache.
- secret-free: Given any of GET /, GET /library, GET /auth/bootstrap?nonce=bad, When responses are captured, Then no response body contains __LORE_BOOTSTRAP_TOKEN__ nor the machine local-key value.
- nonce lifecycle: Given a minted nonce, When GET /auth/bootstrap?nonce=N first time, Then 302 to / with Set-Cookie lore_sid (HttpOnly). When replayed, Then 410. When unknown/expired nonce, Then 410. When Sec-Fetch-Dest: iframe present, Then rejected (not 302).
- auth-store degradation: Given machine-auth store construction fails (injected fault), When GET /, Then 200 index.html (unauthenticated state); When GET /auth/bootstrap?nonce=N, Then 503 with actionable JSON — never a blanket 500 on page loads.

AC:
- All scenarios exist as executable tests in packages/lore/tests/integration/static-serving.bun.test.ts; suite runs under bun test only.
- Run tests → all RED; failure reason is "missing implementation" (module/endpoint absent), not a test bug.
