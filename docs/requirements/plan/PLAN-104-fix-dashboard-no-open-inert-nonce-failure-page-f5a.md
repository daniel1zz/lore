---
id: PLAN-104
type: plan
role: plan
title: "Fix — dashboard --no-open inert + nonce-failure page (F5a defects D1/D2)"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: SPEC-105
phases:
  - {name: "RED"}
  - {name: "GREEN"}
---
## Why

Two defects found by reproduction on 2026-07-29 while diagnosing a user-reported
`NONCE_INVALID / "Bootstrap nonce was already used"` error page.

### D1 — `lore dashboard --no-open` is inert (flag never honoured)

`citty@0.1.6`'s bundled mri parser (`node_modules/citty/dist/index.mjs:170`) rewrites ANY
`--no-X` argument into `out[X] = false`; the literal key `"no-open"` is therefore never
present in `args`. Both call sites read `args["no-open"]`
(`commands/dashboard.ts:329` packaged, `:650` dev) → always `undefined` → always falsy →
the browser is opened unconditionally.

Measured (PATH-shimmed `open` recorder, throwaway corpus, `--api-port 8909`):

    $ lore dashboard --api-port 8909 --no-open
    OPEN_CALLED args=http://localhost:8909/auth/bootstrap?nonce=3516a488-...

Blast radius beyond UX: **AC-F5A-1's own e2e oracle runs `dist/lore dashboard --no-open`**
— that AC has been asserting a no-browser topology while every execution actually spawned
one. A live false oracle.

`--no-open` is the ONLY `no-`prefixed flag in the whole CLI (verified by grep over
`adapters/cli/`), so the fix is local; no general negation-handling layer is warranted.

### D2 — nonce-failure response is a bare JSON envelope, violating this spec's own Failure Modes table

The table already mandates: *"Nonce consumed/expired/unknown → 410 + human-readable page
naming `lore dashboard` re-launch"*. `static-serving.ts::handleNonceBootstrap` instead
returns `jsonError(...)`, so a user who replays the launch URL gets raw JSON in the
viewport. This is an implementation deviation, not a design change.

## What (decided)

- D1: honour the negated form. The flag definition and both read sites must agree with
  what citty actually produces. Keep `--no-open` as the user-facing spelling (it is
  documented, used by AC-F5A-1's oracle, and by the static e2e harness).
- D2: replace the JSON body with a self-contained HTML page (still `410`), which:
  - names the `lore dashboard` relaunch as the fix,
  - client-side probes `GET /api/auth/me` and, when it answers authenticated, forwards
    the browser to `/` — so a replayed link on an already-logged-in browser lands in the
    dashboard instead of a dead end.

### Constraint that shaped D2 (do not "simplify" past it)

`lore_sid` is scoped `Path=/api` (`auth.ts:187`, deliberate minimal-exposure choice noted
at `routes.ts:122`). `/auth/bootstrap` therefore NEVER receives the cookie, so the endpoint
cannot detect an existing session server-side. Widening the cookie path to `/` was
considered and REJECTED (it would put the session cookie on every static asset request and
would require amending this spec's security narrative + an ADR). The client-side
`/api/auth/me` probe achieves the same UX inside the existing cookie scope.

## Acceptance

- AC-F5A-9 (`--no-open` honoured; oracle intercepts the opener, never trusts argv parsing)
- AC-F5A-10 (410 + text/html page, names relaunch, forwards authenticated browsers)

Both are script-mode ACs on the governing spec; close with `lore verify`.

## Verified NOT broken (do not "fix")

- Nonce single-use logic is correct: first request `302`, replay `410` (`createNonceStore`
  reviewed + reproduced; compiled binary matches source).
- Real Chrome hits `/auth/bootstrap` exactly ONCE and follows the 302 — no prefetch, no
  replay (probe server capture: `bootstrapHits: 1`, then `GET /`, then favicon).
- `open` is invoked exactly once per launch in the default path.
