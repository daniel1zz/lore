---
id: ADR-019
type: adr
role: decision
title: "A newly-armed structural oracle enforces from a baseline and carries an auditable exemption ledger, never a tree-wide green"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Context

`check:test-budgets` (spec-a-test-case-s-timeout-budget-must-be-declared-when-its)
armed this wave. Its landing AC, **AC-TB-1**, asserts *"the oracle exits 0 on the
repo tree once the reported instance declares an explicit timeout"* — written on
the belief that one instance was in violation.

Measured at landing: **55 violations across 28 files** (spawn counts 3-9; 31 of
them merely touch the 3-spawn threshold). The task that closed the one reported
instance therefore could not turn AC-TB-1 green, and the plan closed with its
central claim carrying zero supporting runs.

This is the repo's own recorded pattern reproducing on itself: *a new
deterministic gate retroactively invalidates the whole back-catalogue, because
its predicate evaluates at close time against data authored under the old rules*
(`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`).

## Decision

**A newly-armed structural oracle is never required to exit 0 on the whole tree
as its landing criterion.** Its landing AC set is instead:

1. **Baseline-scoped enforcement** — the oracle exits 0 over files changed after
   a NAMED baseline commit. New debt is blocked from the first commit onward.
   For `check:test-budgets` the baseline is **`48d3dbc`**, the merge that landed
   the oracle on `main`; the 55 violations measured at that commit are its
   initial ledger.
2. **An auditable exemption ledger** — every pre-existing violation is recorded
   with path, line, the measured quantity, and the reason it is exempt. The
   ledger is data the oracle reads, not a `--exclude` glob buried in the script.
3. **Ledger completeness is itself asserted** — an exempt entry that no longer
   matches a real violation must fail loud, so the ledger cannot outlive the debt
   it describes and quietly become a suppression list.

The exemption is written **in preference to synthesizing the artifact the
predicate looks for**. Declaring 55 timeout values nobody measured would satisfy
the checker while producing 55 numbers indistinguishable, afterwards, from
measured ones — the exact anti-pattern already recorded in this repo.

## Consequences

- The oracle's signal stays honest: a red result always means NEW debt.
- The back-catalogue stays visible and countable rather than silently excluded.
- No fabricated measurements enter the tree.
- The existing 55 violations are **not fixed** by this decision. The ledger is
  the record that they exist; retiring them is separate, schedulable work.
- Cost: two mechanisms (baseline resolution + ledger validation) instead of one
  boolean. That cost is what buys a checker whose red means something.
- **Debt reduction carries a mandatory ledger edit.** Criterion 3 means that
  fixing a pre-existing violation turns the oracle RED until its ledger entry is
  retired. This is fail-loud working as designed, not a defect — but it is the
  consequence most likely to surprise a future reader, so any work that retires
  debt must retire the matching ledger row in the same commit.

## Alternatives rejected

| Option | Why rejected |
|---|---|
| Full sweep — declare all 55 budgets now | 55 numbers nobody measured; converts a real oracle into a formality and destroys the distinction between a measured budget and a placeholder |
| Raise the detector's threshold until the count is small | Hides the class rather than the instances; the threshold is the contract, tuning it to fit the back-catalogue inverts the direction of evidence |
| Leave AC-TB-1 permanently red | A permanently-red check is operationally indistinguishable from an unwired one — every future reader learns to ignore it, and the next real violation lands invisibly |
| Silent `--exclude` list in the script | Unauditable: nobody can tell later whether an excluded path was debt or a deliberate design |

## Scope

This decision governs **every** structural oracle armed in this repo, not only
`check:test-budgets`. `check:no-timer-retry` (armed in the same wave) happens to
be clean on its three declared paths and needs no ledger today; if it ever
widens its path list, the same three criteria apply.

## Corollary — where a structural oracle's target list lives

A target list that lives in **prose** is unverifiable: a grep over a path that
does not exist returns zero matches, indistinguishable from a clean file. So the
same "a checker's red must mean something" thesis applies to the checker's
INPUT, not only its verdict.

Rule: **declare a structural oracle's path list as spec `code_anchors`**, where
`lore status --check-drift` already reports a missing path as drift — rather than
as prose each bespoke checker must remember to validate. Where prose is
unavoidable, the checker MUST assert existence of every listed path and fail loud
on a miss.

(The incident that produced this rule is recorded in the governing spec's own
Contract Details, not here.)
