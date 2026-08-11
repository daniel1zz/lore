---
id: TASK-539
type: task
role: plan
title: "GREEN — honour --no-open + serve human-readable nonce-failure page"
status: archived
priority: medium
phase: "GREEN"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-104
plan: PLAN-104
---
Turn the RED tests from `task-red-failing-tests-for-no-open-suppression-nonce-failure`
GREEN. Do NOT edit those test files — if a test looks wrong, report it instead of weakening it.

## D1 — honour `--no-open` (`packages/lore/src/adapters/cli/commands/dashboard.ts`)

Root cause: `citty@0.1.6`'s bundled mri (`node_modules/citty/dist/index.mjs:170`) rewrites
ANY `--no-X` token into `out[X] = false`, so the literal key `"no-open"` never exists.
`args["no-open"]` at `:329` (packaged) and `:650` (dev) is therefore always `undefined`.

Fix both read sites AND the flag definition (`:686`) so they agree with what citty actually
produces. Keep `--no-open` as the user-facing spelling: it is documented, and both
AC-F5A-1's oracle and the static e2e harness invoke it. Whatever shape you land on, the
default (flag absent) MUST stay "open the browser".

Leave a `// reason:` comment naming the mri negation behaviour — the next reader will
otherwise "restore" the obvious-looking `args["no-open"]`.

## D2 — human-readable nonce-failure page (`packages/lore/src/adapters/http/static-serving.ts`)

`handleNonceBootstrap` currently answers `jsonError(...)` for consumed/expired/unknown,
which contradicts this spec's own Failure Modes row:
"Nonce consumed/expired/unknown → 410 + human-readable page naming `lore dashboard` re-launch".

Replace the body with a self-contained HTML page (status stays `410`, `Content-Type:
text/html`) that:
  - states the launch link has already been used / expired,
  - names re-running `lore dashboard` as the fix,
  - client-side probes `GET /api/auth/me` and forwards to `/` when it answers
    authenticated, so a replayed link on a logged-in browser lands in the dashboard.

Keep the three outcomes collapsed into ONE response shape (the caller must not need to
distinguish which) — that property is already documented in the module header; update the
header prose to match the new shape.

### Constraint — do NOT widen the cookie

`lore_sid` is `Path=/api` (`auth.ts:187`), a deliberate minimal-exposure choice
(`routes.ts:122`). `/auth/bootstrap` consequently never receives the cookie, which is WHY
the probe is client-side. Widening the path to `/` was considered and rejected at planning
time (it would need a spec security-narrative amendment plus an ADR). Do not "simplify" the
probe away by reading the cookie server-side.

### Do not regress

- successful redemption: unchanged `302` + `Set-Cookie` + `Location: /`
- `Sec-Fetch-*` guard: still `403` JSON, still evaluated BEFORE the nonce store is touched
- machine-auth unavailable: still `503` JSON (AC-F5A-7 asserts this shape)
- static asset / SPA fallback dispatch order: untouched

## Oracles (worktree-scoped; full suite runs on main after merge)

- `bun run build` first (these tests spawn `dist/lore`)
- `bun test packages/lore/tests/integration/dashboard-command.bun.test.ts -t "no-open"`
- `bun test packages/lore/tests/integration/static-serving.bun.test.ts -t "nonce failure page"`
- `bun run test:changed <base>` for transitive reverse-dep selection
- `bun run typecheck`

Assert the matched test count on every `-t`-filtered run — a filter that matches nothing
still exits 0 on partial-match runners. Record each with `lore evidence`, then release.
