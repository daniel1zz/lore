---
id: BASE-077
type: baseline
role: intent
title: "Standard: testing"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-094
---
# Standard: testing

Rules for test placement and test isolation from the team's live corpus.

Each rule is an AS-n in four parts. The rule records (`extra.rules`) are the source of truth; the section below renders all 4 of them (AS-13, AS-14, AS-24, AS-25) as stored on 2026-10-10 so a reader of this body sees all four parts. Edit rules with `lore rule set`, then re-render.

Confidence uses the baseline vocabulary (core baseline.ts RULE_CONFIDENCES): established, undecided, unconfirmed, observed. Observed means what the code does today, measured on the date given, with the owner's intent not yet confirmed; it is the value used for rules recorded from the code. As used in this node, enforced by guaranteed means a mechanism or test in the code refuses a violation, both means a mechanism covers part and written guidance the rest, and prompt-only means written guidance only.

## AS-13: A test that touches bun:sqlite (SQLiteStore, the CLI loader) is named *.bun.test.ts and runs under bun test; every other *.test.ts runs under vitest; one file never mixes runners.

- Confidence: established; enforced by: guaranteed; lifecycle: live
- **Current Reality**: vitest.config.ts excludes **/*.bun.test.ts and marks bun:sqlite as an SSR external; test:bun runs 'bun test .bun.test' in packages/lore. Measured 2026-10-10: no non-.bun.test.ts file under packages/lore/tests imports bun:sqlite or 'bun' at top level.
- **Target Rule**: Same as today.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed.
- **Examples**:
  - tests/unit/store/sqlite-store.bun.test.ts runs only under 'bun run test:bun'.
  - A vitest file importing loader.ts fails to resolve bun:sqlite; the pure logic moves to a *-render.ts sibling instead.

## AS-14: Tests and smoke runs never write this repository's own .lore corpus; any run that creates or edits docs uses a throwaway corpus (mkdtemp + lore init, cwd inside it) and never reuses a server it did not start.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: Only the dashboard e2e global setups isolate mechanically (temp corpus, assertPortFree / assertServerIsOurs). Unit and integration tests and smoke scripts rely on the root CLAUDE.md rule; nothing refuses a test-time write to the repo's .lore/lore.db.
- **Target Rule**: A test-run marker makes corpus resolution or the store refuse any write to the repository's own .lore/lore.db, so the rule holds without author discipline.
- **Current Exceptions**: AD-7
- **Migration**: Issue #121: add a test-environment guard (setup file or corpus-resolution check) and a red control proving it refuses a write to the repo corpus.
- **Examples**:
  - packages/dashboard/tests/e2e/global-setup.ts builds a temp corpus and refuses a squatting server on 8787.
  - A CLI integration test spawns lore with cwd set to its mkdtemp corpus, never the repo root.

## AS-24: The scoped regression command (bun run test:changed <base>) selects tests for both runners: every changed test, every test that statically imports a changed source file directly or through other files, the tests that run the built program whenever product source changed, and both pre-push guard tests whenever hooks or shipped assets changed. It prints a count per runner and a reason per selected file, fails loudly when changed source selects nothing, and fails if a selected test fails.

- Confidence: observed; enforced by: guaranteed; lifecycle: live
- **Current Reality**: Measured 2026-10-10 in scripts/changed-tests.ts: selectAffectedTests (:689) picks changed tests (changed-test), every test whose static-import reverse closure reaches a changed file (transitive, BFS over buildImportGraph :399), every test spawning the program when any packages/{lore,core}/src file changed (binary-consumer, :481), and tree-scanning oracles whose scope matches, which covers both pre-push guard tests on any hooks/ or assets/ change (:616, :674). formatAccounting (:813) prints selected N per runner and a reason per file. runCli (:1062) exits 1 when files changed but nothing was selected (isLoudZero :802), builds dist/lore first for a compiled consumer, then returns the first non-zero runner status. Dynamic import() is invisible by design (:342). Tests: tests/unit/scripts/changed-tests-selector.test.ts, changed-tests-cli.bun.test.ts.
- **Target Rule**: The scoped regression command (bun run test:changed <base>) selects tests for both runners: every changed test, every test that statically imports a changed source file directly or through other files, the tests that run the built program whenever product source changed, and both pre-push guard tests whenever hooks or shipped assets changed. It prints a count per runner and a reason per selected file, fails loudly when changed source selects nothing, and fails if a selected test fails.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed: the code already meets the target. Recorded from the 2026-10-10 uncited-spec mapping (slice 3b).
- **Examples**:
  - Given a change to a core file imported by a service that a bun test imports; when test:changed --list runs; then that bun test is listed with a transitive-import reason.

## AS-25: The one typecheck command (bun run typecheck) checks core, the main package and its tests, the scripts, the dashboard, its tests and its end-to-end tree, and each sub-command runs alone on a fresh clone: a generated prerequisite such as the dashboard route tree is generated first, or the run fails naming the command that recovers it, instead of reporting misleading type errors.

- Confidence: observed; enforced by: guaranteed; lifecycle: live
- **Current Reality**: Measured 2026-10-10 in package.json:16-23: typecheck chains typecheck:core, :lore, :lore-tests, :scripts, :dashboard, :dashboard-tests and :dashboard-e2e. The only generated prerequisite is the gitignored dashboard route tree (packages/dashboard/src/routeTree.gen.ts); typecheck:dashboard runs 'bunx @tanstack/router-cli generate' before tsc (dashboard package.json:11) and typecheck:dashboard-tests runs the dashboard prebuild (the same generate) first. The other five need nothing generated, so the 'fail naming the recovery command' branch has no live instance today. Pinned by scripts/tests/typecheck-chain-contract.test.ts (AC-TC-1: dashboard-e2e is in the chain and resolves its files) and typecheck-script-contract.test.ts (AC-TC-3: dashboard-tests with the route tree removed reports no misleading errors).
- **Target Rule**: The one typecheck command (bun run typecheck) checks core, the main package and its tests, the scripts, the dashboard, its tests and its end-to-end tree, and each sub-command runs alone on a fresh clone: a generated prerequisite such as the dashboard route tree is generated first, or the run fails naming the command that recovers it, instead of reporting misleading type errors.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed: the code already meets the target. Recorded from the 2026-10-10 uncited-spec mapping (slice 3b).
- **Examples**:
  - Given a fresh clone with no generated route tree; when bun run typecheck:dashboard-tests runs; then the route tree is generated first and no misleading type error is reported.
