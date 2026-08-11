---
id: TASK-435
type: task
role: plan
title: "Red-first discipline is asked for in prose but never recorded: require a result=fail evidence row from any task claiming it"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Origin

`lore assess plan-implementation-lore-ac-set-the-dangling-ac-ref-detector`
(2026-08-01) — MAJOR gap, dimension `evidence_integrity`, full report in
`knowledge-assessment-implementation-lore-ac-set-the-dangling-ac`:

> T1's verification discipline required each test written RED first with the red run
> recorded. All 13 T1 evidence rows are `result=pass`. Without a red run the six
> suites cannot be distinguished from tests that were green on first execution
> against pre-existing behaviour.

And its recommendation:

> Require at least one `result=fail` evidence row per AC that claims RED-first
> discipline, and reject the claim when the row is absent. T2 recorded its RED and is
> consequently the most trustworthy part of this bundle; T1 recorded none and is
> correspondingly weaker.

## Why this is a mechanism gap, not an implementer mistake

T1 DID run red-first — its completion report documents the exact procedure
(`git stash push` of the implementation, both suites failing with
`TypeError: acService.setCriterion is not a function` and `expected 1 to be 2`, then
`git stash pop`). The discipline was followed; the EVIDENCE of it was never persisted.
Six weeks from now the transcript is gone and only the corpus remains, and the corpus
says thirteen passes and nothing else.

The dispatch prompt asked for red-first in prose. Prose asks; it does not record. The
same slice's T2 happened to persist its RED (as a `result=fail` row, deliberately
labelled expected-per-D7) — so the corpus can prove T2's assertion is live and cannot
prove T1's. That asymmetry came from two agents interpreting the same instruction
differently, which is the signature of a missing mechanism.

This is the identical shape as the family already catalogued in CLAUDE.md: a green run
alone is indistinguishable from an assertion that cannot fail. Here the un-provable
claim is *the test was ever red*.

## Design questions the implementation must settle

1. **Where does the check live?** Candidates: (a) a `plan-close` conjunct — every task
   claiming red-first carries ≥1 `result=fail` row; (b) a `lore evidence` admission
   check at write time; (c) an `assess` dimension only (advisory, i.e. status quo —
   which is what just failed to prevent this). Prefer a deterministic gate over an
   advisory judge, per the standing rule that an AI judge is never a gate.
2. **How is "claims red-first" declared?** A task cannot be required to carry a fail
   row unconditionally — a task that adds no new test legitimately has none. The claim
   needs to be explicit and machine-readable, not inferred from prose in the task body.
3. **Interaction with the append-only evidence log.** A `result=fail` row is permanent.
   Confirm that a deliberate RED row can never be mistaken for an unresolved failure by
   any existing consumer (`lore ready`, the attestation floor, `lore ac list`'s
   ✔/✘ aggregation — note T3 already hit this: it reported AC-ACS-7 rendering as
   `✘(3/1)` because of T2's intentional RED row, and correctly left it alone).
   Question 3 is the one most likely to produce a nasty surprise — settle it before
   building.

## Oracle

- A task declaring red-first with zero `result=fail` rows is REFUSED at the chosen
  enforcement point, and the denial names the task and the missing row.
- Control (proves the check is live, not vacuous): the same task WITH a fail row
  passes, and a task that declares nothing is unaffected — no new friction for work
  that adds no tests.
- The pre-existing `✘(3/1)` aggregation behaviour is unchanged, or if changed, the
  change is deliberate and separately asserted.
