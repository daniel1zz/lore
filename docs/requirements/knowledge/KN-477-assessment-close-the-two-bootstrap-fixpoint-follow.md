---
id: KN-477
type: knowledge
role: knowledge
title: "Assessment: Close the two bootstrap-fixpoint follow-ups: a ledger test that stops delegating membership to the checker, and a rename that carries its four records with it (2026-08-18)"
status: approved
priority: medium
created: 2026-08-18
updated: 2026-08-18
tags: []
parent: PLAN-131
links:
  - {id: PLAN-131, type: informs}
---
# Assessment: partially_met (63/100)

Scope: plan `01M0AJ1VVBD4T8GXXR3C5P629C`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BFI-1 | 40 | No oracle run in this bundle (0 pass/0 fail). Plan frames it as already-landed under a prior archived plan, but binary-provenance.test.ts was never executed here, so the equality-to-real-HEAD oracle is unverified at this commit. | — |
| AC-BFI-2 | 40 | 0 pass/0 fail. binary-provenance-check.test.ts not run in this bundle; exact-exit 0/3/0-skipped behaviour is asserted only by the earlier plan's history, which is not in these materials. | — |
| AC-BFI-3 | 65 | Declared lint (diff + grep) not run here, but the renamed trip suite's AC-BFI-3 describe passes in attested runs (13 pass/0 fail) and pre-push-parity.test.ts passes, giving solid indirect wiring evidence. | 01M0AJ34B4208F41Q9YMQ2BBCW (evidence [5], [10]-[13]) |
| AC-BFI-4 | 40 | 0 pass/0 fail. anchor-coverage-surface.test.ts untouched and unrun in this bundle; enumerator/count equality unverified at this commit. | — |
| AC-BFI-5 | 35 | Checker lint never run here. Worse, the new test's own comment records that spec-corpus-truthfulness-... landed unanchored and unledgered on 2026-08-17, i.e. the tree-wide set-equality predicate was recently violated. No run reconciles that. | 01M0AJ2H4VV9NZ9H1W9FVSXFZB (comment in RED PAIRED case) |
| AC-BFI-6 | 70 | Its declared file was modified and the final attested run shows 16 tests green including the AC-BFI-6 paired RED/GREEN and cohort negative cases, but the AC's own command string was not the recorded one. | 01M0AJ2H4VV9NZ9H1W9FVSXFZB (evidence [5]) |
| AC-BFI-7 | 40 | 0 pass/0 fail. anchor-coverage-stale-exemption.test.ts not touched or run in this bundle; reverse-direction guarantee unverified at this commit. | — |
| AC-BFI-8 | 40 | 0 pass/0 fail. spec-mirror-content-drift.test.ts not run here; the no-repair/hash-equality conditions are unverified at this commit. | — |
| AC-BFI-9 | 62 | Declared diff+grep lint not run, but the renamed suite's AC-BFI-9 describe survives the rename and pre-push-parity.test.ts (which asserts both copies invoke check-anchor-coverage.ts) passes attested. | 01M0AJ34B4208F41Q9YMQ2BBCW (evidence [13]) |
| AC-BFI-10 | 78 | Independent witness is genuinely non-circular (raw sqlite3 over a .backup snapshot, no checker stdout/exit), set diff names offenders, pre-fix control and a red were recorded, final run green. Gaps: only 1 of 4 records attested, and the RED case asserts the diff helper on an in-memory copy rather t… | 01M0AJ2H4VV9NZ9H1W9FVSXFZB (evidence [1] control, [2] red, [5] pass) |
| AC-BFI-11 | 88 | git mv preserved history; diff converges all four named sites (CLAUDE.md, parity comment, internal diagnostic, plus corpus anchor evidenced by --check-drift consistent). Two reds recorded incl. the reintroduction red, then the exact AC chain passes attested. Full AC text absent from materials. | 01M0AJ34B4208F41Q9YMQ2BBCW (evidence [1],[2] reds; [5],[10]-[12] pass) |

## Gaps

- The AC-BFI-5 checker lint was not run at this commit, and the new test's own comment in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts records that a live spec landed with no code_anchors and no row in scripts/anchor-coverage-ledger.json on 2026-08-17. That is an admitted violation of AC-BFI-5's set-equality predicate with no reconciling run in the bundle, and it is also the condition that would make the new HAPPY tree-wide assertion red.
- The 'RED PAIRED (declared falsifier)' case in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts asserts only that diffSlugSets(measured, mutatedSlugs).missingFromLedger contains the omitted slug on an in-memory copy. It never invokes the HAPPY case's assertion path against a mutated ledger, so if the HAPPY expectations were weakened or deleted, this 'red' case would remain green — a residual, narrower version of the circular-oracle problem AC-BFI-10 exists to close.
- Only 1 of the AC-BFI-10 task's 4 self-reported evidence records is attested, and record [4] is a failing `bun run test:changed 88eb470506d849853a3cba8e52bada4baa39af53` left with no explanation. The plan declares scripts/changed-tests.ts out of scope, but a failing oracle run recorded against the task and never resolved weakens the trail.
- Case (d) in packages/lore/tests/integration/pre-push-trip.bun.test.ts proves only that `lore status --check-drift` exits 0; it does not assert that this spec's code_anchor names the NEW basename. Drift-clean is consistent with the anchor having been repointed to any existing file, so the corpus-side half of the four-record convergence rests on an indirect signal.
- The task objective was the rename plus convergence of four records, but the change also adds a 4-case AC-BFI-11 describe block (~90 lines) to packages/lore/tests/integration/pre-push-trip.bun.test.ts, including a self-referential fragment-split needle and a repo-wide git grep. It plausibly serves the AC's oracle, but it is an unstated addition to the declared task surface.

## Recommendations

- Set extra.ac_scope on follow-up plans to the ACs they actually close (here AC-BFI-10, AC-BFI-11), so the nine already-landed criteria are not scored as unexercised in-scope work.
- Require the declared falsifier to drive the SAME assertion the happy case uses (e.g. write the mutated ledger to a temp path and re-enter the shared comparison), not a helper invoked directly with a mutated in-memory object.
- When a task records a failing oracle run for a known out-of-scope defect, require an inline annotation naming the owning AC (here AC-TC-4) or a resolving re-run before archiving.
- Re-run the six unexercised AC commands (AC-BFI-1/2/4/5/7/8) at this commit and attach attested evidence, especially AC-BFI-5 given the admitted 2026-08-17 unledgered spec.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 119367ms
- Retried: false
- Truncated sections: spec
- Reasoning clipped for: AC-BFI-10

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 74 | 0.72 | evidence | The two targeted follow-ups (AC-BFI-10, -11) are delivered and evidenced; the other nine declared ACs are unexercised at this commit, so spec-wide delivery is unproven here. |
| evidence_integrity | 62 | 0.7 | evidence | Reds-first discipline visible on both tasks, but attested ratio 0.39, several inconclusive records, an unexplained failing test:changed run, and one red that tests the helper not the assertion. |
| scope_fidelity | 92 | 0.85 | evidence | Diff touches only the four declared record sites plus the two new describe blocks. No checker change, no assets/ or hooks/ edits, docs/requirements left verbatim as instructed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BFI-5 | The AC-BFI-5 checker lint was not run at this commit, and the new test's own comment in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts records that a live spec landed with no code_anchors and no row in scripts/anchor-coverage-ledger.json on 2026-08-17. That is an admitted violation of AC-BFI-5's set-equality predicate with no reconciling run in the bundle, and it is also the condition that would make the new HAPPY tree-wide assertion red. |
| evidence_integrity | major | AC-BFI-10 | The 'RED PAIRED (declared falsifier)' case in packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts asserts only that diffSlugSets(measured, mutatedSlugs).missingFromLedger contains the omitted slug on an in-memory copy. It never invokes the HAPPY case's assertion path against a mutated ledger, so if the HAPPY expectations were weakened or deleted, this 'red' case would remain green — a residual, narrower version of the circular-oracle problem AC-BFI-10 exists to close. |
| evidence_integrity | minor | AC-BFI-10 | Only 1 of the AC-BFI-10 task's 4 self-reported evidence records is attested, and record [4] is a failing `bun run test:changed 88eb470506d849853a3cba8e52bada4baa39af53` left with no explanation. The plan declares scripts/changed-tests.ts out of scope, but a failing oracle run recorded against the task and never resolved weakens the trail. |
| outcome | minor | AC-BFI-11 | Case (d) in packages/lore/tests/integration/pre-push-trip.bun.test.ts proves only that `lore status --check-drift` exits 0; it does not assert that this spec's code_anchor names the NEW basename. Drift-clean is consistent with the anchor having been repointed to any existing file, so the corpus-side half of the four-record convergence rests on an indirect signal. |
| scope_fidelity | minor | AC-BFI-11 | The task objective was the rename plus convergence of four records, but the change also adds a 4-case AC-BFI-11 describe block (~90 lines) to packages/lore/tests/integration/pre-push-trip.bun.test.ts, including a self-referential fragment-split needle and a repo-wide git grep. It plausibly serves the AC's oracle, but it is an unstated addition to the declared task surface. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Set extra.ac_scope on follow-up plans to the ACs they actually close (here AC-BFI-10, AC-BFI-11), so the nine already-landed criteria are not scored as unexercised in-scope work. | Plan declares no ac_scope, so all 11 ACs are in scope while only 2 have runs. |
| process | Require the declared falsifier to drive the SAME assertion the happy case uses (e.g. write the mutated ledger to a temp path and re-enter the shared comparison), not a helper invoked directly with a mutated in-memory object. | A red that only exercises the diff helper cannot detect weakening of the happy assertion itself. |
| process | When a task records a failing oracle run for a known out-of-scope defect, require an inline annotation naming the owning AC (here AC-TC-4) or a resolving re-run before archiving. | An unexplained fail in the trail is indistinguishable from an unaddressed regression. |
| spec | Re-run the six unexercised AC commands (AC-BFI-1/2/4/5/7/8) at this commit and attach attested evidence, especially AC-BFI-5 given the admitted 2026-08-17 unledgered spec. | Spec-wide green is currently asserted only by a prior archived plan not present in these materials. |

## Unverifiable Materials

- AC-BFI-11's full criterion statement: Truncated out of the supplied structured AC table; only the task description enumerates the four record sites, so the criterion's own grep clause and site list could not be checked directly.
- AC-BFI-10's full criterion statement: Statement is cut off mid-sentence in the materials, so the exact describe-title and message requirements could only be compared against the task description.
- Oracle runs for AC-BFI-1, -2, -4, -5, -7, -8: Zero pass/fail records in this bundle; the earlier plan that landed them is archived and not included.
- scripts/check-anchor-coverage.ts and scripts/anchor-coverage-ledger.json contents: Not in the diff or materials, so the independent witness's claimed replication of the checker's live-spec and anchored predicates could not be compared against the checker itself.
- Pre-existing body of packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts (incl. loadShippedLedger, copyLedger, REPO_ROOT, the retained cardinality assertion at old line 219): Only the added hunk is visible; whether the original cardinality assertion and its circular comment were kept or reworded is not shown.
- Corpus code_anchors for the spec after the rename: Only indirectly evidenced by `lore status --check-drift` exiting 0; the anchor value itself is not in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.39
