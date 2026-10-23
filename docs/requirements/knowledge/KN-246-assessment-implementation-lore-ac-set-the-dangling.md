---
id: KN-246
type: knowledge
role: knowledge
title: "Assessment: Implementation — lore ac set + the dangling-ac_ref detector (2026-08-01)"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-23
tags: []
parent: PLAN-085
links:
  - {id: PLAN-085, type: informs}
---
# Assessment: met (80/100)

Scope: plan `01KYXNZT15AXWBXKTSK3X5M1P3`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-ACS-1 | 82 | Named oracle 'replaces the statement in place' passes twice, once orchestrator-attested outside the worktree. Only the service-layer half is evidenced; no run shows `lore ac list` printing the new text, and no diff confirms id/count invariance. | task-t1-lore-ac-set-service-cli-six-dimension-suite (evidence [1], [8]) |
| AC-ACS-2 | 84 | Oracle 'unknown id exits 4 naming declared ids' passes agent-run and orchestrator-attested. Test title encodes both exit code and stderr enumeration; assertion contents unverifiable without the diff. | task-t1-lore-ac-set-service-cli-six-dimension-suite (evidence [2], [9]) |
| AC-ACS-6 | 82 | Oracle 'leaves sibling criteria and other extra keys untouched' passes twice incl. attested. Byte-identity of siblings is asserted only inside unseen test code; no diff to confirm the comparison is byte-level rather than shallow. | task-t1-lore-ac-set-service-cli-six-dimension-suite (evidence [6], [10]) |
| AC-ACS-7 | 86 | Strongest AC: T2 records a real RED (exit 2, 3 dangling named), the e2e fixture proves the negative half via mkdtemp+lore init, and T3 plus orchestrator record green (0 dangling). Green rests on 3 ledger exemptions whose per-id spec-version citations are not in the bundle. | task-t2-dangling-ac-ref-detector-plus-its-seeded-dangling (evidence [1] 28 tests, [2] RED exit 2), task-t3-diagnose-and-disposition-the-three-measured-dangling-ac (evidence [1], [4] green with 3 exemptions) |
| AC-ACS-3 | 84 | CLI-level oracle 'no field flag exits 2' passes agent-run and attested, and the test name maps to the BOUNDARY dimension. The version-unchanged half (no empty write) is asserted only inside unseen test code. | task-t1-lore-ac-set-service-cli-six-dimension-suite (evidence [3], [11]) |
| AC-ACS-4 | 74 | Oracle 'demotes an approved spec to draft' passes twice incl. attested, covering the approved->draft half. The draft-stays-draft case and the `lore log` no-status-transition-entry assertion are not separately evidenced by any recorded run. | task-t1-lore-ac-set-service-cli-six-dimension-suite (evidence [4], [12]) |
| AC-ACS-5 | 82 | Oracle 'mode-inconsistent flag exits 4' passes agent-run and attested, matching D5a's document-state boundary. Whether stderr names both the flag and the actual mode is unverifiable from the tails alone. | task-t1-lore-ac-set-service-cli-six-dimension-suite (evidence [5], [13]) |

## Gaps

- T1's verification discipline required each test written RED first with the red run recorded. All 13 T1 evidence rows are result=pass. Without a red run the six suites cannot be distinguished from tests that were green on first execution against pre-existing behaviour.
- diff_available=false and tests_touched=false. Nothing in the bundle lets an auditor confirm that ac-service.ts routes demotion through CorpusService (D2), that argv faults are raised pre-service (D5a), or that the sibling-identity test compares bytes.
- The AC has two halves: approved->draft, and draft-stays-draft with lore log recording no status-transition entry. Only the first is named by an evidenced oracle.
- The repo-corpus green depends on 3 ledger exemptions. The plan forbade guessing between 'lost' and 'retired' and required citing the spec version where each id disappeared; that citation is absent from every T3 evidence row and output tail.
- Scanned-row counts drift across runs (2191, 2212, 2214, 2215) with no stated cause. Benign corpus growth is the likely explanation, but T2's own digest warns that a lower count should trigger truncation suspicion, and no run documents the reconciliation.

## Recommendations

- Require at least one result=fail evidence row per AC that claims RED-first discipline, and reject the claim when the row is absent.
- Record the T3 diagnosis — per-id spec version of disappearance and the merged/lost judgement — in the ledger row reason field and echo it in the detector's exemption output line.
- Split AC-ACS-4 and AC-ACS-1 into one oracle per assertion (status demotion vs. lore log absence; service write vs. lore ac list output).
- Add an attested unfiltered run of each touched test file alongside the -t-scoped AC oracles.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 66964ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | All 7 ACs have >=1 runner-attested pass; AC-ACS-7 shows the load-bearing RED then green. Sub-clauses of AC-ACS-1/4 lack their own evidenced run. |
| evidence_integrity | 68 | 0.75 | evidence | Attested ratio 0.38, no diff, T1 has zero red runs despite RED-first mandate, and only -t-filtered runs. T2's recorded RED is the trail's strongest element. |
| scope_fidelity | 88 | 0.7 | evidence | Three tasks match the plan's disjoint anchors and sequencing; T3 ran after T2. Exemption-only disposition is permitted by the plan but its justification is unshown. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-ACS-1 | T1's verification discipline required each test written RED first with the red run recorded. All 13 T1 evidence rows are result=pass. Without a red run the six suites cannot be distinguished from tests that were green on first execution against pre-existing behaviour. |
| evidence_integrity | major | — | diff_available=false and tests_touched=false. Nothing in the bundle lets an auditor confirm that ac-service.ts routes demotion through CorpusService (D2), that argv faults are raised pre-service (D5a), or that the sibling-identity test compares bytes. |
| outcome | minor | AC-ACS-4 | The AC has two halves: approved->draft, and draft-stays-draft with lore log recording no status-transition entry. Only the first is named by an evidenced oracle. |
| outcome | minor | AC-ACS-7 | The repo-corpus green depends on 3 ledger exemptions. The plan forbade guessing between 'lost' and 'retired' and required citing the spec version where each id disappeared; that citation is absent from every T3 evidence row and output tail. |
| evidence_integrity | minor | AC-ACS-7 | Scanned-row counts drift across runs (2191, 2212, 2214, 2215) with no stated cause. Benign corpus growth is the likely explanation, but T2's own digest warns that a lower count should trigger truncation suspicion, and no run documents the reconciliation. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require at least one result=fail evidence row per AC that claims RED-first discipline, and reject the claim when the row is absent. | T2 recorded its RED and is consequently the most trustworthy part of this bundle; T1 recorded none and is correspondingly weaker. |
| plan | Record the T3 diagnosis — per-id spec version of disappearance and the merged/lost judgement — in the ledger row reason field and echo it in the detector's exemption output line. | An exemption is auditable only if the reason survives; the current output names a count, not a justification. |
| spec | Split AC-ACS-4 and AC-ACS-1 into one oracle per assertion (status demotion vs. lore log absence; service write vs. lore ac list output). | Compound ACs let a single passing test title stand in for two unmeasured claims. |
| process | Add an attested unfiltered run of each touched test file alongside the -t-scoped AC oracles. | Every T1 row shows '5 tests \| 4 skipped'; nothing proves the six tests pass together. |

## Unverifiable Materials

- Implementation diff for ac-service.ts, ac.ts, and the four test files: diff_available=false; no source shown, so D2 routing, D5a exit boundary, and test assertion strength cannot be checked.
- scripts/ac-ref-exemption-ledger.json rows and their reasons: Referenced only by count in output tails; contents and per-id spec-version citations not in the bundle.
- T3's diagnosis of where AC-CP-3/5/7 disappeared (lore log / lore diff output): No evidence row carries the diff or log output the plan required as the basis for the lost-vs-retired decision.
- Full-suite / regression run after T1's changes: Only -t-filtered oracle runs and typecheck are recorded; no broad test run evidences non-regression.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.38
