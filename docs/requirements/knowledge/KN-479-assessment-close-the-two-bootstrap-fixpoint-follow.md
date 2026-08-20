---
id: KN-479
type: knowledge
role: knowledge
title: "Assessment: Close the two bootstrap-fixpoint follow-ups: a ledger test that stops delegating membership to the checker, and a rename that carries its four records with it (2026-08-20)"
status: approved
priority: medium
created: 2026-08-20
updated: 2026-08-20
tags: []
parent: PLAN-131
links:
  - {id: PLAN-131, type: informs}
---
# Assessment: partially_met (71/100)

Scope: plan `01M0AJ1VVBD4T8GXXR3C5P629C`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BFI-1 | 50 | No oracle run in this bundle (0 pass / 0 fail). Landed by a prior archived plan; nothing here re-measures binary_provenance equality to real HEAD. Scored conservatively for absence, not contradiction. | — |
| AC-BFI-2 | 50 | No evidence record. Not re-verified by this plan. Evidence tails for the trip suite mention a dev-stale exit 3 line, but that is the hook wiring test, not this AC's own integration command. | 01M0AJ34B4208F41Q9YMQ2BBCW (trip-suite tail mentions exit 3 provenance line incidentally) |
| AC-BFI-3 | 58 | No run of the declared diff+grep lint command. Indirect support only: the renamed trip suite's AC-BFI-3 cases pass in several tails (13 pass / 0 fail), and pre-push-parity.test.ts passes (evidence [13]). | 01M0AJ34B4208F41Q9YMQ2BBCW (evidence [5],[13]) |
| AC-BFI-4 | 50 | No oracle record in this bundle; enumerator seam untouched by the diff. Unverifiable here. | — |
| AC-BFI-5 | 52 | No direct checker run recorded. The AC-BFI-10 work strengthens its oracle (set equality now asserted independently), but the ledger checker command itself is unmeasured in this bundle. | 01M0AJ2H4VV9NZ9H1W9FVSXFZB (ledger set assertion added) |
| AC-BFI-6 | 58 | No run of the AC's own command, but the ratchet test file it names passes in AC-BFI-10/12 evidence tails, which explicitly list the 'RED PAIRED ... exits EXACTLY 1 / EXACTLY 0' case as green. | 01M0ANDAB7HWFF2E01J7Q4CCDD (evidence [3] tail names AC-BFI-6 cases passing) |
| AC-BFI-7 | 50 | No evidence record for the stale-exemption test file; not touched by the diff. Unverifiable here. | — |
| AC-BFI-8 | 50 | No evidence record for spec-mirror-content-drift.test.ts in this bundle; untouched by the diff. Unverifiable here. | — |
| AC-BFI-9 | 58 | Declared lint command not run here. Indirect: the AC-BFI-9 suite lives in the renamed file which passes 13/0, and pre-push-parity.test.ts (whose comment the diff updates) passes. | 01M0AJ34B4208F41Q9YMQ2BBCW (evidence [5],[13]) |
| AC-BFI-10 | 87 | Diff adds the exactly-titled describe block, an independent sqlite3-snapshot witness, set diff naming slugs, plus the declared falsifier. Red-first recorded (expected-fail), pre-fix control recorded, then pass attested. Residual: witness re-implements the checker's predicate by hand. | 01M0AJ2H4VV9NZ9H1W9FVSXFZB (evidence [1] control, [2] expected-fail, [5] pass) |
| AC-BFI-11 | 88 | git mv rename plus all four record sites converged and diff-visible (CLAUDE.md, internal diagnostic, parity comment) with the corpus anchor asserted by case (d). Two expected-fail reds recorded, attested pass with '13 pass / 0 fail' and the PASS echo. | 01M0AJ34B4208F41Q9YMQ2BBCW (evidence [1],[2] red; [5],[10]-[12] pass) |
| AC-BFI-12 | 85 | Shared assertLedgerSlugSetMatchesMeasured extracted; both happy and falsifier paths call it, and the falsifier asserts it THROWS naming the slug. Mutation red measured (gutted body → exit 1). Stale comment rewritten naming disposition commit 2c606027. | 01M0ANDAB7HWFF2E01J7Q4CCDD (evidence [3] pass, [5] expected-fail with mutation description) |
| AC-BFI-13 | 84 | Case (d) now reads the stored code_anchors via `lore get --json` and asserts an anchor ends with pre-push-trip.bun.test.ts, in addition to --check-drift exit 0. One attested pass; no separate red recorded for this half. | 01M0ANDAB7HWFF2E01J7Q4CCDD (evidence [4] pass) |

## Gaps

- AC-BFI-1 through AC-BFI-9 are declared on the spec but have 0 pass / 0 fail oracle records in this bundle. Their status rests on the prior archived plan, not on anything verifiable here; only AC-BFI-3/6/9 get incidental support from passing suites in packages/lore/tests/integration/pre-push-trip.bun.test.ts and packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts tails.
- The independence claim in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts rests on hand-copying the checker's live-spec population (type='spec' AND deleted_at IS NULL) and anchored predicate from scripts/check-anchor-coverage.ts into raw SQL. Nothing binds the two, so if the checker's population definition changes the witness measures a different set and the happy case can go green (or red) for reasons unrelated to the ledger.
- The falsifier in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts operates on an in-memory ledger copy and asserts the shared helper throws. That closes the two-independent-assertions gap, but it still never runs against the on-disk scripts/anchor-coverage-ledger.json, so the shipped oracle path itself is not exercised in the red direction.
- Case (d)'s new anchor-value assertion in packages/lore/tests/integration/pre-push-trip.bun.test.ts has one recorded pass and no recorded red, so its discriminating power (that repointing the anchor elsewhere reddens it) is claimed rather than measured.
- Multiple AC-command records are 'inconclusive' with tails truncated before the PASS echo (AC-BFI-11 [3],[4],[6]; AC-BFI-12 [1],[2]), and attested counts diverge from self-reported counts on two tasks, leaving roughly half the trail unattested.
- The plan declares a single phase with exactly two tasks (AC-BFI-10, AC-BFI-11). Execution added a third task and two new spec ACs (AC-BFI-12, AC-BFI-13) after the first two were attested and archived. The additions are well-justified defect fixes, but they are plan drift that the plan document itself never records.
- packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts shells out to an external `sqlite3` binary for both the .backup and the SELECT. On a machine without it the test errors rather than reporting a ledger verdict, and this environmental dependency is documented only in the function's own docstring.

## Recommendations

- Add a criterion (or extend AC-BFI-10) requiring the test's live-spec/anchored predicate to be pinned to the checker's — e.g. by exporting the predicate from a shared module the checker consumes, or asserting both populations agree on a fixture corpus.
- Require a recorded expected-fail for every newly added assertion half, including AC-BFI-13's anchor-value check, before the AC is attested.
- Treat 'inconclusive' evidence records as unattested: store the exit code plus enough tail to include the PASS echo, and reconcile attested vs self-reported counts before archiving a task.
- When lore assess raises follow-ups against an already-archived plan, amend the plan's phase/task list (or open a successor plan) instead of appending tasks silently.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 100540ms
- Retried: false
- Truncated sections: spec

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.78 | evidence | Both declared follow-ups landed with diff-visible substance: independent slug-set witness plus rename with all four records converged; the two later ACs also closed. |
| evidence_integrity | 68 | 0.72 | evidence | Red-first discipline and mutation reds are real, but attested ratio 0.48, several inconclusive/truncated records, and nine ACs with no runs at all. |
| scope_fidelity | 84 | 0.7 | evidence | Checker, assets/, and docs/requirements untouched as required. Mild drift: a third task and two new ACs (12/13) were added beyond the plan's declared two follow-ups. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BFI-1 | AC-BFI-1 through AC-BFI-9 are declared on the spec but have 0 pass / 0 fail oracle records in this bundle. Their status rests on the prior archived plan, not on anything verifiable here; only AC-BFI-3/6/9 get incidental support from passing suites in packages/lore/tests/integration/pre-push-trip.bun.test.ts and packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts tails. |
| outcome | major | AC-BFI-10 | The independence claim in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts rests on hand-copying the checker's live-spec population (type='spec' AND deleted_at IS NULL) and anchored predicate from scripts/check-anchor-coverage.ts into raw SQL. Nothing binds the two, so if the checker's population definition changes the witness measures a different set and the happy case can go green (or red) for reasons unrelated to the ledger. |
| outcome | minor | AC-BFI-12 | The falsifier in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts operates on an in-memory ledger copy and asserts the shared helper throws. That closes the two-independent-assertions gap, but it still never runs against the on-disk scripts/anchor-coverage-ledger.json, so the shipped oracle path itself is not exercised in the red direction. |
| evidence_integrity | minor | AC-BFI-13 | Case (d)'s new anchor-value assertion in packages/lore/tests/integration/pre-push-trip.bun.test.ts has one recorded pass and no recorded red, so its discriminating power (that repointing the anchor elsewhere reddens it) is claimed rather than measured. |
| evidence_integrity | minor | AC-BFI-11 | Multiple AC-command records are 'inconclusive' with tails truncated before the PASS echo (AC-BFI-11 [3],[4],[6]; AC-BFI-12 [1],[2]), and attested counts diverge from self-reported counts on two tasks, leaving roughly half the trail unattested. |
| scope_fidelity | minor | AC-BFI-12 | The plan declares a single phase with exactly two tasks (AC-BFI-10, AC-BFI-11). Execution added a third task and two new spec ACs (AC-BFI-12, AC-BFI-13) after the first two were attested and archived. The additions are well-justified defect fixes, but they are plan drift that the plan document itself never records. |
| outcome | minor | AC-BFI-10 | packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts shells out to an external `sqlite3` binary for both the .backup and the SELECT. On a machine without it the test errors rather than reporting a ledger verdict, and this environmental dependency is documented only in the function's own docstring. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Add a criterion (or extend AC-BFI-10) requiring the test's live-spec/anchored predicate to be pinned to the checker's — e.g. by exporting the predicate from a shared module the checker consumes, or asserting both populations agree on a fixture corpus. | The current witness re-implements the definition; silent divergence reopens a weaker form of the circularity AC-BFI-10 closed. |
| process | Require a recorded expected-fail for every newly added assertion half, including AC-BFI-13's anchor-value check, before the AC is attested. | AC-BFI-12 exists precisely because a non-discriminating falsifier was attested; the same pattern recurs unmeasured in AC-BFI-13. |
| process | Treat 'inconclusive' evidence records as unattested: store the exit code plus enough tail to include the PASS echo, and reconcile attested vs self-reported counts before archiving a task. | attested_evidence_ratio 0.48 with truncated tails weakens an otherwise disciplined red-first trail. |
| plan | When lore assess raises follow-ups against an already-archived plan, amend the plan's phase/task list (or open a successor plan) instead of appending tasks silently. | AC-BFI-12/13 landed under a plan whose stated scope is two tasks, so the plan record no longer describes what executed. |

## Unverifiable Materials

- Oracle runs for AC-BFI-1, AC-BFI-2, AC-BFI-4, AC-BFI-5, AC-BFI-7, AC-BFI-8: No evidence records in the bundle; landed by a prior archived plan and not re-measured here.
- The declared lint commands for AC-BFI-3 and AC-BFI-9 (diff hooks/pre-push assets/project/pre-push plus grep): Never run in this bundle; only the behavioural trip suite and parity unit test appear as passing.
- scripts/check-anchor-coverage.ts contents and scripts/anchor-coverage-ledger.json contents: Not in the diff or materials, so the fidelity of the test's hand-copied predicate and the ledger's actual rows cannot be checked.
- Full stdout for the inconclusive evidence records: Tails truncated to ~4KB and cut before the PASS echo, so pass/fail cannot be confirmed from them.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 7
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.48
