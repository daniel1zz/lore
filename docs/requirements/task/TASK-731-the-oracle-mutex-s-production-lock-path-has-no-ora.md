---
id: TASK-731
type: task
role: plan
title: "The oracle mutex's production lock path has no oracle: every test injects a temp dir, so a per-worktree lock would pass all seven cases and serialize nothing"
status: archived
priority: high
phase: "isolation"
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PLAN-124
plan: PLAN-124
---
`scripts/oracle-lock.ts` is the mutex every future oracle run serializes on — `package.json`'s
`test` script IS `bun scripts/oracle-lock.ts sh -c "..."`. Its production lock directory comes
from `resolveDefaultLockDir`, which shells `git rev-parse --git-common-dir` so that the main
checkout and every linked worktree resolve to ONE shared path and therefore contend.

**Nothing asserts that.** `scripts/tests/oracle-lock.test.ts` injects an `mkdtemp` directory on
every call, and its own module header states plainly that `resolveDefaultLockDir` "is exercised
only by actually running `bun run test` for real, never by this file". A per-worktree lock would
compile, pass all seven existing cases, and protect nothing — which is exactly the defect the
mutex exists to prevent. Found by `lore assess` (MAJOR, outcome dimension) and machine-verified
against the file on 2026-08-17.

AC-OX-7 was split out of AC-OX-4 rather than folded into it: AC-OX-4's prose promises TWO layers
(lock BEHAVIOUR and lock PATH) while its oracle drives only the first, and the standing rule is
to split any AC whose prose names two layers.

## What to build

ONE new test file, `scripts/tests/oracle-lock-checkout-scope.test.ts`, that is fully hermetic:

1. `mkdtemp` a throwaway directory, `git init` a repo inside it (set `user.email`/`user.name`
   locally, make one commit — `git worktree add` needs a commit to branch from).
2. `git worktree add` a real LINKED worktree of that throwaway repo.
3. Import the EXPORTED `resolveDefaultLockDir` from `scripts/oracle-lock.ts` and CALL it —
   ⛔ never reimplement its logic, never assert via `grep` that it exists. This is a production-
   wiring assertion; a test that recomputes `git rev-parse` itself and compares two of its own
   values would pass while the production function was deleted.
4. Assert (a): `resolveDefaultLockDir(mainCheckoutPath)` equals an independently computed
   `git rev-parse --git-common-dir` from that path, resolved to an ABSOLUTE path.
5. Assert (b) — **the discriminating one**: `resolveDefaultLockDir(linkedWorktreePath)` returns
   the SAME absolute directory as `resolveDefaultLockDir(mainCheckoutPath)`.

⛔ Clause (b) is the entire point. A main-checkout-only assertion is provably non-discriminating:
measured on this repo 2026-08-17, `git rev-parse --git-dir` and `git rev-parse --git-common-dir`
BOTH print `.git` from the main checkout, and diverge only from a linked worktree. If you assert
only from the main checkout, the falsifier below will NOT turn your test red and you will have
built the exact false oracle this task exists to close.

## Mandatory falsifier run (declared on the AC, not optional)

AC-OX-7 declares a machine-checkable falsifier:

- path: `scripts/oracle-lock.ts`
- find: `rev-parse", "--git-common-dir`
- replace: `rev-parse", "--git-dir`
- declared exit code: **1**

Apply that mutation, run the AC's command, and CONFIRM it exits exactly 1 — then restore the
file. Record that red from your own shell at the moment it is red:

```
lore evidence <this-task> --oracle test --command "<exact cmd>" --result expected-fail
```

⛔ A green-only run does not verify this oracle. If the mutation does NOT turn your test red,
your test is not discriminating — fix the test, not the falsifier.

## Boundaries

- ⛔ Do NOT change `resolveDefaultLockDir`'s behaviour. It is already correct; this task adds the
  missing assertion, not a fix. The only permitted edit to `scripts/oracle-lock.ts` is the
  temporary falsifier mutation, which MUST be reverted before you commit.
- ⛔ Everything runs inside `mkdtemp`. Never `git init`, `git worktree add`, or acquire a lock
  inside this repo's own checkout — a real lock acquisition here would wedge concurrent oracle
  runs, and this repo has live concurrent sessions.
- ⛔ Do not write to the repo's `.lore/` corpus or `docs/requirements/`.
- Six-dimension coverage applies. Beyond HAPPY/(the falsifier's) NEGATIVE, consider: BOUNDARY (a
  repo with no commits, or a path that is not a git repo at all — `resolveDefaultLockDir` throws
  a loud Error by contract, assert that shape rather than swallowing it), ERROR, STATE (two calls
  return a stable value), REGRESSION (the existing seven `oracle-lock.test.ts` cases still pass).
