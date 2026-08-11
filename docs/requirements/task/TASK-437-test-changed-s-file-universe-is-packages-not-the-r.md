---
id: TASK-437
type: task
role: plan
title: "test:changed's file universe is packages/** not the repo: the whole scripts/ tier is invisible even to rule (a), changed-test-file selection"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Measured 2026-08-01, immediately after `ca4ccbc` widened the binary-consumer predicate
(`task-test-changed-cannot-see-the-whole-integration-cli-tier-the`). That fix closed one hole
in rule (c). This is the SAME class one notch further out, and it defeats rule **(a)** — the
simplest rule the selector has.

## What was measured

An implementer working on `scripts/check-test-budgets.ts` ran `bun run test:changed <base>` and
got **0 tests selected in both runners**, and said so — which is the only reason this is known.
The orchestrator reproduced it on main:

    bun run scripts/changed-tests.ts --list f3242aa
    vitest: selected 1
      [vitest] packages/lore/tests/unit/scripts/changed-tests-selector.test.ts (changed-test)
    bun: selected 0

The `f3242aa..HEAD` diff at that moment contained NINE `scripts/` files, including:

- `scripts/check-test-budgets.ts` (changed source, +306 lines)
- `scripts/tests/check-test-budgets.test.ts` (**changed test file**, +294 lines, 43 tests)
- `scripts/tests/check-ac-ref-integrity.test.ts` (changed test file)
- `scripts/changed-tests.ts`, `scripts/check-ac-ref-integrity{,-core}.ts`, `scripts/tests/fixtures.ts`

`scripts/tests/check-test-budgets.test.ts` was **itself modified** and still was not selected.
Rule (a) is literally "changed test files" — so this is not a dependency-tracing subtlety, it
is a universe problem.

## Root cause

`scripts/changed-tests.ts` builds its `FileMap` from `packages/*/src/**/*.ts(x)` and
`packages/*/tests/**/*.ts` ONLY (module header §2 and the loader at ~line 516). Nothing under
`scripts/` is ever loaded. Consequently ALL THREE rules miss it:

- **(a) changed test files** — a `scripts/tests/*.test.ts` path is never in the map, so it is
  never recognised as a test file at all.
- **(b) reverse-dependency closure** — `scripts/check-test-budgets.ts` is not a node in the
  graph, so nothing can be reachable FROM it.
- **(c) binary-consumer** — gated on `LORE_OR_CORE_SRC_PREFIX_RE = /^packages\/(?:lore|core)\/src\//`
  (line 292), and its candidates come from the same map.

So the selector's universe is `packages/**`, not the repository. `scripts/tests/` holds real
oracles — `check-test-budgets.test.ts`, `check-ac-ref-integrity.test.ts` — and both were
modified in that window while the tool reported a confident green over a selection of 1.

## Why it matters more than the integration-CLI hole

`scripts/` is where this repo's DETERMINISTIC GATES live (test budgets, AC-ref integrity, the
assets-manifest embed, the changed-test selector itself). A silent no-select there means the
oracles that guard the other oracles are the least-covered code in the tree. Two of this
session's three defects were IN `scripts/`.

## Required

- Widen the selector's file universe to include `scripts/**/*.ts` (sources) and
  `scripts/tests/**/*.test.ts` (tests), so all three rules see them. Rule (a) is the minimum
  bar and must work.
- Reverse-dependency tracing must follow `scripts/` → `scripts/tests/` import edges (the tests
  import the scripts directly, so this should fall out of the map widening — verify it does,
  do not assume).
- Decide and document what happens for `scripts/` files with NO test (most of them): they must
  not crash the walk, and they must not silently select everything.
- Runner assignment for `scripts/tests/*.test.ts` stays filename-derived as it already is
  (these are vitest files; there is no `.bun.test.ts` under `scripts/` today — assert that
  assumption rather than hardcoding it).
- ⛔ Do NOT special-case the two known test files. The defect is the universe's boundary. A
  path allowlist is a rejected solution.
- The module header documents the `packages/*` universe in §2 — rewrite it, do not leave it
  contradicting the code.
- ⚠ `scripts/changed-tests.ts` is under active concurrent modification pressure this week
  (`ca4ccbc` just landed there). Re-read the current file; do not work from the pre-`ca4ccbc`
  shape, which had no `classifyBinaryConsumer` and no `binaryConsumerKind` on the selection data.

## Oracle

- An end-to-end control that would have caught this: for a change touching
  `scripts/check-test-budgets.ts`, `--list <base>` selects
  `scripts/tests/check-test-budgets.test.ts`. Assert BOTH the rule-(a) case (the test file
  itself changed) and the rule-(b) case (only the source changed) — they are different failures.
- A NEGATIVE control: a change touching only a `scripts/` file that has no test still exits 0
  and selects nothing spurious.
- REGRESSION: the `ca4ccbc` behaviour is untouched — `packages/lore/src/service/verify-runner-service.ts`
  still selects `packages/lore/tests/integration/cli/verify.test.ts` as `binary-consumer`, and
  `build-first` still fires only for the compiled kind.
- `bunx vitest run packages/lore/tests/unit/scripts/changed-tests-selector.test.ts` → exit 0
- `bun run typecheck` → exit 0

Note the reflexive hazard: this task changes the very tool used to scope-select tests. ⛔ Do not
use `bun run test:changed` as this task's own acceptance oracle — run tests by explicit path.
