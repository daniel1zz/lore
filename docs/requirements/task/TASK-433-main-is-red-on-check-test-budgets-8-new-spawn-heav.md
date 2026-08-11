---
id: TASK-433
type: task
role: plan
title: "main is RED on check-test-budgets: 8 new spawn-heavy assess test cases landed with no declared timeout, escaping through the scripts/ selector blind spot that was fixed hours later"
status: archived
priority: critical
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
**main is currently RED on a deterministic oracle.** Measured 2026-08-01 at `7463a62` by the
orchestrator during merge-verification of an unrelated task:

    $ bun run scripts/check-test-budgets.ts > out.log 2>&1; echo $?
    2
    $ bunx vitest run scripts/tests/check-test-budgets.test.ts
    FAIL  ... > exits 0 against THIS checkout's real test tree ...
    AssertionError: expected 2 to be +0

## The 8 new violations

All in test files landed by `98fc22b` (merged as `aff5d74`, "fix(assess): derive a plan's own
commit set instead of asking for a git range"):

| File | Line | Spawns | Case |
|---|---|---|---|
| `packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts` | 391 | 6 | PRIMARY ORACLE: excludes every interleaved foreign commit… |
| `packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts` | 91 | 8 | derives only the plan's own commits… |
| `packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts` | 139 | 5 | produces the same file content as today's naive contiguous range… |
| `packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts` | 189 | 7 | keeps only the descendant when two matched commits… |
| `packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts` | 255 | 3 | a subsequent commit that names neither task slug… |
| `packages/lore/tests/integration/cli/assess-ai.bun.test.ts` | 368 | 9 | excludes every interleaved foreign commit… |
| `packages/lore/tests/integration/cli/assess-ai.bun.test.ts` | 428 | 8 | produces the same reachable content… |
| `packages/lore/tests/integration/cli/assess-ai.bun.test.ts` | 475 | 3 | produces a loud, named outcome instead of a silent empty derived diff |

Each calls a spawn helper 3-9 times with **no explicit `it()`/`test()` timeout argument**.

## Required

- Declare an explicit timeout on each of the 8 cases — a number in ms as the third argument, or
  `{ timeout: <ms> }`. The oracle judges DECLARATION, never the number
  (`spec-a-test-case-s-timeout-budget-must-be-declared-when-its` D1).
- ⛔ **Do NOT add ledger rows.** `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`
  is explicit that **new debt is never exempt**; the ledger is a frozen baseline, not a
  suppression list. The 58 existing rows are pre-existing debt only.
- Pick each timeout from the case's actual measured cost (spawn count is a hint, not a rule) —
  do not paste one constant across all 8 without looking.

## Attribution — NOT a cross-session schema interaction, and this matters

Checked, because the obvious suspicion is wrong:

- `98fc22b`'s parent is `f3242aa`. The test-budget ledger re-key (`d6b87a9`, rows now keyed on
  `(path, titleFingerprint, spawnCount)`) is **NOT** an ancestor of `98fc22b`.
- `98fc22b` touched neither `scripts/test-budget-ledger.json` nor `scripts/check-test-budgets.ts`.

So the re-key did not invalidate anything of theirs. These are 8 genuinely-new violations that
would have failed on their own branch under the OLD `(path, line)` key too.

## Root cause of the ESCAPE — the reason this is worth recording, not just fixing

At base `f3242aa`, `bun run test:changed` **could not see `scripts/tests/check-test-budgets.test.ts`
at all**: the selector's file universe was `packages/**`, so the entire `scripts/` tier — including
the test that asserts this very oracle exits 0 — was invisible even to rule (a), changed-test
selection. A session adding 8 spawn-heavy test cases therefore got a confident scoped green while
walking new debt into main.

That blind spot was fixed hours later in `7f02c1f`
(`task-test-changed-s-file-universe-is-packages-not-the-repo-the`). This incident is the measured
evidence that the fix was load-bearing rather than theoretical: **the escape and the fix happened in
the same 24 hours, in opposite directions.** Verify after fixing that `test:changed` now DOES
select `scripts/tests/check-test-budgets.test.ts` for a change to these files — i.e. that the
escape route is genuinely closed, not merely that the symptom is gone.

## Oracle

- `bun run scripts/check-test-budgets.ts > out.log 2>&1; echo $?` → **0** (exit code measured
  unpiped), with the "0 new violations" line present
- `bunx vitest run scripts/tests/check-test-budgets.test.ts` → exit 0
- The three touched test files still pass: run each by explicit path (note
  `assess-ai.bun.test.ts` is a `bun test` file, the other two are vitest — do not mix runners)
- ⛔ Do NOT "fix" this by raising or removing the oracle's threshold, and do not touch
  `scripts/check-test-budgets.ts` — the oracle is correct here and this task's anchors
  deliberately exclude it.
