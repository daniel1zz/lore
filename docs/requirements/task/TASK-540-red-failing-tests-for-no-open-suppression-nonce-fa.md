---
id: TASK-540
type: task
role: plan
title: "RED — failing tests for --no-open suppression + nonce-failure HTML page"
status: archived
priority: medium
phase: "RED"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-104
plan: PLAN-104
links:
  - {id: TASK-539, type: blocks}
---
Write FAILING (RED) tests for AC-F5A-9 and AC-F5A-10. Implementation is NOT in scope —
the paired GREEN task owns `commands/dashboard.ts` and `static-serving.ts`; do not touch them.

## AC-F5A-9 — `--no-open` must actually suppress the browser opener

Test name MUST match `-t "no-open"` (the AC's oracle grep).
File: `packages/lore/tests/integration/dashboard-command.bun.test.ts`.

The oracle must intercept the OPENER, not assert on parsed argv — argv parsing is exactly
what is broken, so a test that reads `args["no-open"]` would encode the bug as the
expectation. Reproduction recipe that works today (used to find the defect):

  - create a shim dir with an executable `open` that appends its argv to a log file
  - spawn `dist/lore dashboard --api-port <free> --no-open` with `PATH=<shim>:$PATH`,
    cwd inside a throwaway `mkdtemp` + `lore init` corpus
  - assert the log stays EMPTY; then assert the control case (no `--no-open`) DOES record
    exactly one invocation, so the shim itself is proven live

Follow this repo's spawn hygiene: `.bun.test.ts` files that exec `dist/lore` need the
binary built; never write into the repo's own `.lore/`.

## AC-F5A-10 — nonce-failure response is a human-readable HTML page

Test name MUST match `-t "nonce failure page"`.
File: `packages/lore/tests/integration/static-serving.bun.test.ts`.

Assert, for each of consumed / expired / unknown nonce:
  - status stays `410`
  - `Content-Type` is `text/html`
  - body names the `lore dashboard` relaunch
  - body carries the client-side `GET /api/auth/me` probe that forwards an authenticated
    browser to `/`
  - body is NOT the `{"ok":false,...}` JSON envelope

Cover the six dimensions where they apply here (HAPPY = successful 302 still unchanged;
NEGATIVE/BOUNDARY = the three failure outcomes; REGRESSION = the existing `Sec-Fetch-*` 403
guard and the 503 machine-auth degradation must keep their CURRENT response shapes —
AC-F5A-7 asserts the 503, do not convert it to HTML).

## Done means

Both test names run RED against current `main` for the right reason (assertion failure on
the new expectation, NOT a spawn/setup error — show the failure output). Record evidence
with `lore evidence` and release the task.
