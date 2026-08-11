---
id: TASK-411
type: task
role: plan
title: "test:changed's fourth invisible edge: a tree-scanning oracle test judges files it never imports, so the test that guards test-budget debt is never selected by the change that creates it"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: KN-233, type: relates-to}
  - {id: TASK-437, type: relates-to}
---
The remaining gap after `7f02c1f` (`task-test-changed-s-file-universe-is-packages-not-the-repo-the`),
and the DIRECT root cause of the incident chain that produced
`task-main-is-red-on-check-test-budgets-8-new-spawn-heavy-assess`.

## What was measured, 2026-08-01 at `99ed7cd`

`bun run test:changed 7463a62 --list` for a diff touching THREE test files under
`packages/lore/tests/**` (the 8-timeout fix):

    vitest: selected 2
      [vitest] packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts (changed-test)
      [vitest] packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts (changed-test)
    bun: selected 1
      [bun] packages/lore/tests/integration/cli/assess-ai.bun.test.ts (changed-test)
    build-first: no

`scripts/tests/check-test-budgets.test.ts` was **not** selected — even though it is the test whose
sole purpose is asserting that the changed files introduce no new test-budget debt, and even though
those exact files had just made it RED.

## Root cause — a dependency edge import tracing cannot see, again

`7f02c1f` put `scripts/**` INSIDE the selector's universe, so rule (a) (changed test file) and rule
(b) (reverse-dependency closure) now work for changes to `scripts/` itself. But
`scripts/tests/check-test-budgets.test.ts` reaches the files it judges by **scanning the filesystem
at runtime** (`scanRepoTree()`, 535 test files), not by importing them. There is no import edge from
it to `packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts`, so no reverse-dependency
walk can ever reach it from that change.

This is EXACTLY the same shape as the two escapes already fixed in this file:

| Escape | The invisible edge | Fix |
|---|---|---|
| `vitest --changed` blind to `.bun.test.ts` | runner boundary | rule (c), original |
| integration-CLI tests spawn the CLI | `spawnSync` subprocess | `ca4ccbc`, widened rule (c) |
| `scripts/` not in the universe at all | — | `7f02c1f` |
| **tree-scanning oracles judge files they never import** | **runtime filesystem scan** | **this task** |

The pattern is now established three times over: whenever a test reaches its subject by any means
other than a static import, the selector needs an explicit rule for it.

## Which tests are affected

Tree-scanning (verified by grep for real-tree scanning):

- `scripts/tests/check-test-budgets.test.ts` — asserts the real tree has 0 new spawn-budget violations
- `scripts/tests/check-no-nul-bytes.test.ts` — asserts no tracked text-source file contains a raw NUL

Both assert a property of the WHOLE TREE. Any change to any file in their scan scope can flip them.
`check-ac-ref-integrity.test.ts` and `check-no-timer-retry.test.ts` did NOT match the real-tree grep —
confirm individually whether they scan too rather than assuming from the filename.

## Required

- Add a selection rule: a **tree-scanning oracle test** is selected whenever ANY file within its scan
  scope changed. Derive the set of such tests from a property the test itself declares, NOT from a
  hardcoded list — a hardcoded list is the "add the one file to a list" anti-pattern this file has
  already rejected twice. Options to weigh explicitly (pick one, justify it in the module header):
  (a) a content marker in the test file the way rule (c) already keys on `dist/lore`/`LORE_BIN`/`INDEX_TS`;
  (b) selecting these tests whenever ANY test file changed, since their scan scope IS the test tree;
  (c) an explicit declaration the test exports.
- Whatever the mechanism, it must be **conservative in the right direction**: over-selecting a
  whole-tree oracle costs one extra fast test file; under-selecting it is how debt reached main.
- ⛔ Do not weaken or special-case any existing rule. `ca4ccbc`'s compiled-vs-source `build-first`
  distinction and `7f02c1f`'s universe widening are both REGRESSION surface.
- Rewrite the module header's selection-rules section — it will now describe four rules, not three.

## Oracle

- The incident control: for a change touching ONLY `packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts`,
  `--list` selects `scripts/tests/check-test-budgets.test.ts`. This is the exact case that failed
  above and would have caught the 8-violation escape.
- Same for `scripts/tests/check-no-nul-bytes.test.ts` on a change to any tracked text-source file.
- NEGATIVE: a change touching ONLY a non-scanned file (e.g. a `.md` doc) does not drag the whole
  tree-scanning set in — the rule must be scoped, not a blanket "always select these".
- REGRESSION (all three prior fixes intact): `packages/lore/src/service/verify-runner-service.ts`
  still selects `packages/lore/tests/integration/cli/verify.test.ts` as `binary-consumer`;
  `build-first` still fires only for the compiled kind; a changed `scripts/tests/*.test.ts` still
  selects itself.
- `bunx vitest run packages/lore/tests/unit/scripts/changed-tests-selector.test.ts` → exit 0
- `bun run typecheck` → exit 0

⛔ Reflexive hazard: this task changes the tool used to scope-select tests. Do NOT use
`bun run test:changed` as its own acceptance oracle — run tests by explicit path.

## SECOND measured occurrence — hours after this task was filed

Same session, same day. An implementer fixing
`task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1` added 179 lines / 4 new cases to
`packages/lore/tests/integration/cli/assess-ai.bun.test.ts`. Three of them are spawn-heavy (3-4
spawn-helper calls) with no declared timeout. `check-test-budgets` on main at `1b3ce6f` → **exit 2**
again, three new violations at lines 700 / 757 / 794.

The selector control, run by the orchestrator at that commit:

    bun run scripts/changed-tests.ts --list 99ed7cd
    vitest: selected 34
    # grep -c 'scripts/tests/check-test-budgets.test.ts' -> 0

34 files selected. The one oracle that had just gone red because of this exact diff: **not among
them.**

This is the same escape as the 8-violation incident, but with the FIRST cause already removed —
`7f02c1f` had put `scripts/**` inside the universe by then. So the universe fix was necessary and
not sufficient, and the remaining edge is exactly the runtime-filesystem-scan edge this task
describes. Two independent occurrences in one day, by two different actors, on two different diffs.

Note the shape of the second one: it was an ORCHESTRATOR-dispatched agent given an explicit,
carefully-scoped oracle list. It ran every oracle it was told to run, correctly and thoroughly. The
budget oracle was simply not on the list, and the selection tool that exists precisely to answer
"what else should I run?" answered wrongly. That is the argument for fixing selection rather than
lengthening dispatch checklists: a checklist that must name every whole-tree oracle by hand will
be wrong again the next time one is added.
