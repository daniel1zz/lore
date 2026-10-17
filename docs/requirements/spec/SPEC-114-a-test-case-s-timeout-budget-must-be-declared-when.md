---
id: SPEC-114
type: spec
role: spec
title: "A test case's timeout budget must be declared when its spawn count makes the default unsafe: a structural oracle instead of a bigger number"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-10-17
tags: []
---
## Overview

A test case that spawns the compiled binary many times while relying on the runner's DEFAULT timeout budget converts machine load into a phantom regression. A phantom regression at integration time is what makes a real one invisible: the reviewer either dismisses the failure (and misses the next real one) or spends the integration window re-running a suite.

Goal: a test case's timeout budget must be DECLARED whenever its spawn count makes the default budget unsafe, enforced by a deterministic oracle that goes red on the offending shape rather than on a slow machine.

## Measured Gap

Full suite at commit `8227dd1` in a clean isolated worktree (`git status --porcelain` empty): typecheck 0, vitest 401 files / 6816 pass / 0 fail, `bun test` 1600 pass / **1 fail** across 147 files in 615s.

The single failure:

```
tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts:203
error: create plan failed:            <- empty stderr = child killed mid-flight
(fail) lore approve <plan-under-reachable-spec> — no advisory (AC-VRW-5b) [6222.68ms]
  ^ this test timed out after 5000ms.
```

Attribution, measured rather than reasoned:

- 3/3 green re-running that file in isolation (`RUN1_EXIT=0 / RUN2_EXIT=0 / RUN3_EXIT=0`, `2 pass 0 fail` each).
- The file EXISTS on `main` and `git diff main 8227dd1 -- <file>` is EMPTY — the 60-commit range under integration never touched it, so it cannot be a regression of that range.
- Machine load average 5.19 with unrelated GUI processes competing.
- The failing `it` spawns the compiled binary 6+ times (init, create prd, create spec, ac add, create plan, approve) inside bun's DEFAULT 5000ms budget. Its lighter sibling in the SAME file (`:127`) passes.

Root cause: the budget is neither a function of the spawn count nor declared anywhere. It is not "the machine was busy" — a correct test states what it needs.

## Scope

In scope:
- A deterministic structural oracle that fails when a single test case spawns the compiled binary at or above a threshold count without declaring an explicit timeout.
- Declaring explicit budgets on the instance(s) the oracle reports.

Out of scope, each deliberately:
- Raising any timeout number as THE fix. The defect is an undeclared budget, not a small one; a bigger default hides every future mismatch.
- A global runner timeout raise (`bun test --timeout <big>`): converts a loud budget mismatch into an invisible slow test.
- Reorganising test directories or relocating e2e-shaped tests out of `tests/unit/`. Worth considering separately; not needed to close this defect.
- The `AC-072-9` concurrency flake — a different root cause, specified separately.

## Options Considered

| # | Option | Against it |
|---|---|---|
| 1 **(recommended)** | Structural source oracle: scan test sources, count spawn-helper invocations per test body, require an explicit timeout argument at or above the threshold | Lexical counting cannot see a spawn hidden behind an indirection; accepted, because the threshold only needs to catch the DIRECT multi-spawn shape that actually caused this |
| 2 | Raise the global runner timeout | REJECTED. Symptom treatment: a test that needs 20s and a test that hangs become indistinguishable |
| 3 | Prose discipline ("declare a budget for spawn-heavy tests") | REJECTED. Prose reinforcement of a test-hygiene rule has measurably failed in this repo before (the subagent-termination case needed a hook after four prose attempts) |

## Design Decisions

- **D1 — The oracle judges DECLARATION, never the value.** At or above the threshold it requires an explicit timeout argument of any value. Policing the number would need runtime data the oracle does not have; forcing the author to name a budget is the behaviour change that matters.
- **D2 — Threshold is 3 direct spawns in one test body.** Two spawns fit the default budget comfortably on a loaded machine (measured: the passing sibling case); three is where the observed failure lives.
- **D3 — Hosted as a repo script with its own npm-script entry**, alongside `typecheck` — not as a `lore status --check-*` flag. `lore status` checks corpus facts; this is a source-structure fact about this repo's own tests, and lore's binary must not grow a check that only its own repo can use.
- **D4 — Fixing the reported instance means DECLARING its budget**, which does raise a number. That is not option 2: the number becomes visible, reviewed, and attached to a spawn count, and the oracle prevents the next undeclared one.
- **D5 — Parse failure is loud.** A test file the oracle cannot parse exits non-zero naming the path. Never a silent skip — a silently skipped file is indistinguishable from a clean one.

- **D6 — Baseline-scoped enforcement via an auditable ledger, with a THREE-value exit taxonomy.** Arming a structural oracle retroactively puts every pre-existing violation in breach (`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`), so enforcement is scoped to a baseline instead of demanding a repo-wide sweep in the same slice. The violations measured at the arming commit are recorded in `scripts/test-budget-ledger.json`, one row per violation carrying `path` / `line` / `spawnCount` / `reason`. The ledger is DATA THE ORACLE READS, never a suppression switch. Three exit values, deliberately distinct: **0** — every measured violation is matched by a ledger row and no unledgered violation exists; **2** — at least one violation has no matching row, i.e. NEW debt, which is never exempt; **5** — ledger INTEGRITY failure, kept separate from new debt because the two demand opposite repairs (a row whose violation no longer exists must be DELETED; a row naming a nonexistent path must be CORRECTED). Matching is EXACT on `(path, line, spawnCount)`: a drifted spawn count is orphaned rather than re-exempted, so growing an already-ledgered case still trips. Silently re-exempting either failure would let the ledger outlive the debt it documents and widen back into a blanket suppression — the precise defect the ADR exists to prevent.
- **D7 — The ledger contract is verified by running the WHOLE oracle test file, never a `-t` name filter.** Measured 2026-08-01: `vitest -t <pattern>` with a pattern matching nothing exits **0** having executed zero tests — indistinguishable from passing. A name-filtered criterion therefore rots silently the moment a test is renamed, and this repo's existing `-t`-filtered criteria (AC-TB-2/3/5) carry that latent risk. Running the file whole also removes the partial-pass ambiguity D6's four behaviours would otherwise have: any failing case in the file fails the run.

## Acceptance Criteria

- **AC-TB-1 (HAPPY)**: the oracle exits 0 on the repo tree. Since the baseline-ledger landing (`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`) this holds for a DIFFERENT reason than originally written: exit 0 now means *every* pre-existing violation is exempted by an auditable ledger row AND no new debt exists — not that the single originally-reported instance declares a budget. The pass condition is `exit 0` alone — every measured violation matched by a ledger row and zero unledgered violations (D6). The counts are an OBSERVATION, not part of the threshold: at main on 2026-08-01 they read 527 files scanned / 58 exempted / 0 new, and all three drift with the tree. The earlier wording asserted a repo state that was false for as long as the oracle exited 2 on 58 unledgered violations.
- **AC-TB-2 (NEGATIVE / control, proves the assertion is live)**: pointed at a fixture test file with 3 spawn calls and no explicit timeout, the oracle exits non-zero and its stdout names that fixture's test title.
- **AC-TB-3 (BOUNDARY)**: a fixture with exactly 2 spawns and no explicit timeout exits 0; the same fixture with a 3rd spawn added exits non-zero.
- **AC-TB-4 (REGRESSION)**: `cli-plan-promote-advisory.bun.test.ts`'s AC-VRW-5b case declares an explicit timeout and passes in isolation.
- **AC-TB-5 (ERROR)**: an unparseable test file makes the oracle exit non-zero with the path in its output, never exit 0.


## Acceptance Criteria (structured)

- [⊘] [script] AC-TB-1: the test-budget oracle exits 0 on the repo tree, meaning every measured violation is matched by an auditable ledger row and zero unledgered violations remain (D6); the scanned/exempted/new counts are an observation that drifts with the tree, never part of the threshold
  script: lint — bun run check:test-budgets
- [⚑] [script] AC-TB-2: pointed at a fixture with 3 spawn calls and no explicit timeout the oracle exits non-zero and names that fixture's test title
  script: test — bunx vitest run scripts/tests/check-test-budgets.test.ts -t 'control fixture is reported'
- [⚑] [script] AC-TB-3: a fixture with exactly 2 spawns and no explicit timeout exits 0 while the same fixture with a 3rd spawn exits non-zero
  script: test — bunx vitest run scripts/tests/check-test-budgets.test.ts -t 'threshold boundary two versus three'
- [⚑] [script] AC-TB-4: the AC-VRW-5b case in cli-plan-promote-advisory.bun.test.ts declares an explicit timeout and passes in isolation
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts
- [⚑] [script] AC-TB-5: an unparseable test file makes the oracle exit non-zero with the path in its output and never exit 0
  script: test — bunx vitest run scripts/tests/check-test-budgets.test.ts -t 'unparseable file is loud'
- [·] [script] AC-TB-6: The baseline ledger fails loud in every direction, never silently re-exempting: a violation with no matching ledger row is reported as NEW debt (exit 2); a ledger row whose violation was fixed, or whose (path,line) matches but spawnCount drifted, is ORPHANED rather than re-exempted (exit 5); a ledger row naming a nonexistent path is reported by name (exit 5); and every row carries path/line/spawnCount/reason. Deliberately run as the WHOLE file with no -t filter: a -t name filter that matches nothing exits 0 with zero tests executed (measured 2026-08-01), which is indistinguishable from passing, so name-filtered ACs silently rot the moment a test is renamed.
  script: test — bunx vitest run scripts/tests/check-test-budgets.test.ts

## Code anchors

- scripts/check-test-budgets.ts
