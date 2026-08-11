---
id: KN-345
type: knowledge
role: knowledge
title: "Retro — a silently-inert CLI flag is the fifth false-oracle vector (lore dashboard --no-open)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: SPEC-105
links:
  - {id: PLAN-104, type: informs}
---
## Symptom

A user hit `410 NONCE_INVALID / "Bootstrap nonce was already used"` on the URL
`lore dashboard` had just auto-opened. Two independent defects surfaced during diagnosis;
the nonce mechanism itself turned out to be correct.

## Root cause 1 — a CLI flag silently inert, and it poisoned an AC that depends on it

`citty@0.1.6`'s bundled mri parser (`node_modules/citty/dist/index.mjs:170`) rewrites ANY
`--no-X` token into `out[X] = false`. The literal key `"no-open"` therefore never exists in
`args`, while both read sites (`commands/dashboard.ts:329` packaged, `:650` dev) test
`args["no-open"]` — always `undefined`, always falsy, browser always opened.

**The generalizable part is not the parser quirk — it is the FIFTH false-oracle vector.**
`AC-F5A-1`'s own script runs `dist/lore dashboard --no-open` and asserts a no-vite,
no-browser packaged topology. That AC has been passing while every execution actually
spawned a browser. A flag whose failure mode is "silently does nothing" corrupts every
oracle that invokes it, and the oracle cannot detect it: the assertion never mentions the
flag's effect, only the state the flag was supposed to produce.

Catalog entry for the existing four vectors (mistyped AC paths / under-match /
wrong execution root / stale compiled binary): **(5) a silently-inert CLI flag — an oracle
that PASSES a flag it never verifies took effect measures a different topology than it
claims.** Detection is the same discipline as the other four: assert the side effect, not
the invocation. Here that means intercepting the opener (a `PATH` shim recording argv) and
pairing it with a control run that PROVES the shim is live — an empty log is otherwise
indistinguishable from a shim that never executed.

## Root cause 2 — implementation silently diverged from its own spec's Failure Modes table

`spec-dashboard-production-packaging-one-command-lore-dashboard` mandates:
"Nonce consumed/expired/unknown → 410 + human-readable page naming `lore dashboard`
re-launch". `static-serving.ts::handleNonceBootstrap` returns `jsonError(...)` instead, so
the user saw a raw JSON envelope in the viewport. Neither the AC set nor the module
CLAUDE.md caught it — `AC-F5A-2` asserts only the STATUS code (`replay ... answers 410`),
and the module CLAUDE.md paraphrased the status-and-message contract without ever pinning
the media type. A Failure Modes row that names a USER-FACING ARTIFACT ("human-readable
page") needs an AC that asserts the artifact's shape, not just its status code.

## What was NOT broken (verified, do not re-investigate)

- `createNonceStore` single-use semantics: first request `302`, replay `410`. Compiled
  binary matches source.
- Real Chrome requests `/auth/bootstrap` exactly ONCE and follows the 302 (probe-server
  capture: `bootstrapHits: 1`, then `GET /`, then favicon). No prefetch, no prerender, no
  replay.
- `open` is spawned exactly once per launch on the default path.
- Diagnosis technique worth reusing: a throwaway `Bun.serve` probe that mimics the real
  302 flow and logs every inbound request settled the "did the browser double-request?"
  question in one shot, where source reading could only speculate.

## Follow-through owed at GREEN landing

`packages/lore/src/adapters/http/CLAUDE.md` currently documents the nonce endpoint as
answering "`410` naming `lore dashboard` re-launch as the fix (all three outcomes collapse
to one response shape)". That entry stays TRUE for status and collapsing, but becomes
INCOMPLETE once the body turns into an HTML page with a client-side `/api/auth/me` probe.
It must be updated in the same change as the implementation — not left for a later sweep.

Constraint recorded so it is not "simplified" away later: `lore_sid` is `Path=/api`
(`auth.ts:187`), so `/auth/bootstrap` never receives the cookie. That is WHY the
authenticated-forward probe is client-side. Widening the cookie to `Path=/` was considered
and rejected (it would put the session cookie on every static asset request and would
require amending the spec's security narrative plus an ADR).

## Fix in flight

`plan-fix-dashboard-no-open-inert-nonce-failure-page-f5a-defects` — AC-F5A-9 (flag
honoured, oracle intercepts the opener) and AC-F5A-10 (410 + `text/html` page naming the
relaunch and forwarding authenticated browsers).
