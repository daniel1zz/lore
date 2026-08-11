---
id: TASK-441
type: task
role: plan
title: "test:changed cannot see the whole integration-CLI tier: the binary-consumer escape hatch matches only .bun.test.ts spawning dist/lore, never a vitest test spawning the entry source"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Measured 2026-08-01 while merge-verifying `task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested`.
A real regression reached the post-merge full suite because `bun run test:changed` — the deterministic
scoped oracle CLAUDE.md tells every worktree implementer to prefer over hand-rolled filters — did not
select the test that catches it.

## What happened

The implementer changed `packages/lore/src/service/verify-runner-service.ts` (ad-hoc runner path now
stamps `ac_ref`). It ran `bun run test:changed <merge-base>`: vitest 46 files / 779 tests, bun 90 files
/ 723 tests, **0 failures**. The post-merge full suite on a clean main then failed:

    FAIL packages/lore/tests/integration/cli/verify.test.ts
      > lore verify — SPEC-069 ad-hoc-task runner path > HAPPY (GREEN)
      AssertionError: expected 'AC-ADHOC-G1' to be undefined

That file directly exercises the changed code and was never selected.

## Root cause — a two-sided hole, not a one-off

`scripts/changed-tests.ts` selects by (a) changed test files, (b) transitive reverse-dependency import
closure, (c) a `binary-consumer` escape hatch for the dependency edge import tracing cannot see.

`packages/lore/tests/integration/cli/verify.test.ts` falls through ALL THREE:

- **(b) fails**: it never imports `verify-runner-service.ts`. It reaches the code by SUBPROCESS —
  `spawnSync("bun", ["run", INDEX_TS, ...args])` at `verify.test.ts:86`. There is no import edge for the
  reverse-dependency walk to traverse.
- **(c) fails**: `isBinaryConsumerCandidate` (`scripts/changed-tests.ts:226-227`) requires the file to be
  a **`.bun.test.ts`** file whose content spawns the **compiled** binary (`dist/lore` / `LORE_BIN`
  marker). This file is neither — it is a vitest `.test.ts`, and it spawns the **entry SOURCE**
  (`src/index.ts`), not `dist/lore`.

So the escape hatch built precisely for "a dependency-closure escape import tracing cannot see through"
covers only ONE of the two ways this repo spawns its own CLI from a test. The compiled-binary spawn is
covered; the source-entry spawn is not.

## Why the class matters more than the instance

Every `tests/integration/cli/*.test.ts` file in this repo uses the same `spawnSync("bun", ["run",
INDEX_TS, ...])` harness. The entire integration-CLI tier is therefore invisible to `test:changed` for
any source change, no matter how central. The oracle reports a confident green over a set that
structurally excludes the tier most likely to catch a behavioural contract change.

This is the same shape as the blind spot the script's own header already documents (`vitest --changed`
being structurally blind to `.bun.test.ts`) — the fix for that one was rule (c). Rule (c) was drawn one
notch too narrow.

## Required

- Widen the binary-consumer predicate: match ANY test file (not only `.bun.test.ts`) whose own content
  spawns this repo's CLI entry — compiled (`dist/lore` / `LORE_BIN`) OR source (`src/index.ts` /
  `INDEX_TS`). Keep the runner assignment derived from the filename as it already is; only SELECTION
  widens.
- The existing "if >=1 binary-consumer was selected, `bun run build` runs FIRST" behaviour must remain
  keyed on the COMPILED-binary case only — a source-entry spawn does not need a fresh `dist/lore`, and
  making every integration-CLI selection force a build would be a needless cost.
- ⛔ Do not fix this by adding the one file to a list. The defect is the predicate's shape.

## Oracle

A test over `isBinaryConsumerCandidate` asserting: a vitest `.test.ts` whose content spawns
`src/index.ts` IS a candidate; a `.bun.test.ts` spawning `dist/lore` still IS (regression); a plain unit
test that spawns nothing is NOT. Plus an end-to-end check that
`bun run test:changed <base> --list`, for a change to `verify-runner-service.ts`, now lists
`packages/lore/tests/integration/cli/verify.test.ts` — a control that would have caught this incident.

## Second finding from the same incident (separate, prose-level)

The third site pinning the old behaviour was missed by a grep keyed on `ac_ref).toBeUndefined()`; this
one subscripts (`evidence[0]?.["ac_ref"]`). That is the standing contiguous-substring lesson firing
again, in the same session in which the CLAUDE.md sweep judged that lesson UNMECHANIZED and kept it.
The keep was correct.
