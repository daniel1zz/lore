---
id: TASK-573
type: task
role: plan
title: "[Skill:implement] F5a fix packaged-mode session auth + add /api/health dashboard stamp"
status: archived
priority: critical
phase: "Phase 2: HTTP serving & auth"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-578, type: blocks}
---
Estimate: M
Approach: Two upstream gaps found by the static e2e harness (both confirmed by direct code reading, not narrative):

GAP-1 (severe, blocks the whole feature): packaged-mode sessions can never authenticate. `static-serving.ts` mints the redeemed-nonce session against `BOOTSTRAP_SESSION_OWNER = "dashboard-local"` (line ~227), but `commands/dashboard.ts` (header comment ~line 36) deliberately never calls `ensureLocalApiKey` in packaged mode — so no `api_keys` row with that name exists. `SessionStore.resolve()` INNER JOINs `sessions` → `api_keys WHERE revoked_at IS NULL`, finds nothing, returns null, and `authenticateRequest` 401s EVERY `/api/*` request from the freshly "authenticated" dashboard. Net effect: the packaged UI loads as a shell and reads no data — the feature is non-functional end-to-end.
ADJUDICATED FIX: packaged mode MUST ensure the machine-scope local key ROW exists (call `ensureLocalApiKey` on the machine-auth store during packaged startup) so redeemed sessions resolve. This does NOT weaken DD-2: DD-2's invariant is that the key is never SERVED over HTTP / never embedded in the built artifact — not that it never exists. The key already exists in `--dev` mode; packaged mode simply stops serving it. Update the now-wrong header comment in `commands/dashboard.ts` accordingly (it asserts an invariant the fix intentionally changes — leaving it would mislead the next reader). Do NOT "fix" this by loosening `SessionStore.resolve()`'s JOIN — that would weaken revocation semantics for every auth path.

GAP-2: `GET /api/health` does not exist at all (only a hardcoded `/health` returning `{ok:true,status:"healthy"}`). Spec Observability + AC-F5A-1/AC-F5A-8 require `/api/health` to carry `dashboard: { embedded, digest, builtAt, skipped? }` from the DD-1 build stamp. Add the route and populate the stamp from the loaded manifest (absent/unavailable assets → `embedded: false`, no fabricated digest).

Source: `knowledge-handoff-agent-task-skill-test-f5a-single-process` (harness author's handoff, names exact file/function locations); spec DD-1/DD-2 + Observability; independently re-confirmed by orchestrator reading `static-serving.ts:227` and `commands/dashboard.ts:36`.
Dimensions: D-FUNC, D-SEC
Scope-Alt: none — GAP-1 makes the shipped feature non-functional; it is not deferrable.
Covers: AC-F5A-1, AC-F5A-2, AC-F5A-8

AC:
- Given the packaged server, When the nonce is redeemed and the resulting `lore_sid` cookie is used, Then `GET /api/status` (and other `/api/*` reads) answer 200, NOT 401 — proven by the existing static e2e `nonce` group going green.
- Given the packaged server, When `GET /api/health` is requested, Then it answers 200 with a `dashboard` object carrying the build stamp (digest + builtAt) that matches the loaded manifest.
- Given the full static harness, When `cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts` runs, Then exit 0 with all 8 tests passing across the three groups (`packaged serve` 4, `nonce` 2, `allowlist and freshness` 2) — report matched counts per group.
- Given `bun run typecheck`, Then exit 0. Given the pre-existing bun integration suites for static serving and dashboard-command, Then still green (no regression from the auth change).
- Given DD-2, When the built artifact and every HTTP response body are grepped, Then no machine-key material appears (the existing `secret-free` integration case must stay green — the key may EXIST but must never be SERVED).
