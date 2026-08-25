---
id: TASK-853
type: task
role: plan
title: "check:test-budgets scans packages/ only, so scripts/tests/ is invisible to it and an AC citing it had zero discriminating power"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: [false-oracle, oracle-design, ratchet]
parent: PRD-001
links:
  - {id: SPEC-114, type: relates-to}
---
MEASURED 2026-08-25 on main. Reported by the implementer on `task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus` and machine-checked by the orchestrator before filing.

`scripts/check-test-budgets.ts`'s `scanRepoTree` walks `<repoRoot>/packages` ONLY. Its own header says so at line 1028: "Scan root is `<repoRoot>/packages` ONLY". So every test file under `scripts/tests/**` is structurally outside the oracle. Confirmed by running it: `check-test-budgets: OK — scanned 706 test file(s); 58 pre-existing violation(s) exempted ...; 0 new violations` — none of the 706 from `scripts/tests/`.

## Why this matters beyond a coverage hole

`spec-a-test-case-s-timeout-budget-must-be-declared-when-its` exists because an undeclared timeout budget converts machine load into a phantom regression. Its enforcement is this script. `scripts/tests/spec-mirror-export.test.ts` is the single most budget-sensitive file in the repo — every case there spawns a full-corpus `--check` at 13.8s warm / 27.9s cold — and it is exactly the file the oracle cannot see.

⛔ The concrete failure this already produced: that task's AC-3 named `bun run check:test-budgets` green as part of its acceptance. It WAS green, and it had **zero discriminating power** over the change — it would have been green whatever budgets the implementer declared, or none. An AC citing a blind oracle certifies nothing while reading as covered. Root CLAUDE.md's own lesson: "RUN a structural oracle BEFORE declaring it as an AC — else the author's file list becomes the AC's blind spot and the AC certifies it as covered."

⛔ The implementer satisfied AC-3's substance anyway (it made the budgets DERIVED arithmetic, `budgetMs(passes, slack)` priced at the cold figure, so each case declares its pass count greppably). That is not a substitute for the oracle seeing the file.

## Two questions the fix must answer, not one

1. **Widen the scan root** to include `scripts/tests/**`. ⛔ The header calls the current root deliberate — `scripts/tests/` holds its own fixtures — so widening needs the fixture-vs-test discrimination to be explicit, not a glob change that starts reporting fixtures as violations.
2. **Budget the retroactive sweep in the SAME slice.** 706 files currently scanned with 58 ledger-exempted violations; widening the root will surface a new back-catalogue at once. `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing` records that a newly-armed gate retroactively invalidates everything pre-existing, and that the sweep plus a written exemption must land together or the gate is unlandable.

## Falsifier

⛔ Not "the script exits non-zero after widening" — a script that crashes on a fixture directory also does that. Three conjuncts:
(a) a test file under `scripts/tests/` with 3+ direct spawns and NO explicit timeout is REPORTED, naming file and line;
(b) GREEN CONTROL in the same run: the same file WITH a declared budget is NOT reported — otherwise the widened scan is just a file-count increase;
(c) the ledger still holds: the 58 pre-existing exemptions plus whatever the sweep adds keep the run at 0 new violations, so the gate is landable.
Smallest mutation that turns it red: revert the scan root to `packages` only — (a) then fails. ⛔ Assert the exit code EQUALS the script's documented value, never merely "non-zero".
