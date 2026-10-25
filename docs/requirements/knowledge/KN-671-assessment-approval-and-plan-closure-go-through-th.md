---
id: KN-671
type: knowledge
role: knowledge
title: "Assessment: Approval and plan closure go through the same checks on every surface (2026-10-12)"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-23
tags: []
parent: PLAN-154
links:
  - {id: PLAN-154, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M4QD7S67202CQZBMKMBBS8RK`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-AP-1 | 88 | 4 attested passes, 9 tests run, PASS line printed. The set() delegation in the diff matches D1-D4 (changed-field refusal, echoed values allowed). The test file is omitted, so per-case fidelity was not seen. | task-skill-implement-set-to-approved-delegates-to-the-approve, task-verify-approval-parity-and-plan-closure-floors-on-main |
| AC-AP-2 | 85 | Attested pass with 7 tests. routes.ts threads If-Match as expectedVersion and approve returns STALE_VERSION before any write. The port only passes reviewer, not the other WriteActorOpts, so attribution beyond the actor is unproven. The test file is unseen. | task-skill-implement-set-to-approved-delegates-to-the-approve |
| AC-AP-3 | 85 | 19 vitest tests pass and the grep holds. The line-318 case now records a judgment. makeApp still wires the port through a leftover RED-era 'as unknown as' cast instead of the typed setApprovalPort. | task-skill-test-red-set-and-approve-parity-tests-on-service-and |
| AC-AP-4 | 90 | Attested pass with >=6 tests. The diff shows T1-T4+H, gate-off (e), parity (f) on details.floor, and the HAPPY/REGRESSION re-baselines with recorded original assertions. The cascade code calls the port and maps err to failed and a refusal to skipped. | task-skill-implement-plan-close-cascade-checks-lore-done-floors |
| AC-AP-5 | 85 | 9 vitest tests pass with attestation. The cascade code matches the err/floor/null mapping, but the test file is omitted from the diff, so the stub call-log membership assertion was not seen. | task-skill-implement-plan-close-cascade-checks-lore-done-floors |
| AC-AP-6 | 90 | Compiled e2e passes after the build. set.ts prints the Cascade archived/skipped/failed lines. The tests assert exact human lines, B staying open, and the floor in --json. | task-skill-implement-plan-close-cascade-checks-lore-done-floors |
| AC-AP-7 | 92 | The equality grep passes on main (n=2, a=2, d=2, no cross-service import). The app.ts diff shows both ports wired at both composition sites. | task-verify-approval-parity-and-plan-closure-floors-on-main |
| AC-AP-8 | 78 | The first typecheck on main failed on a merge-conflict marker in tests/e2e/issue-check.bun.test.ts, which I1 forbids after any merge. A later attested run passed, but nothing records how the conflict was resolved. | task-verify-approval-parity-and-plan-closure-floors-on-main |
| AC-AP-9 | 85 | 7 tests pass. checkDoneFloors and _doneImpl share evaluateDoneFloors, so there is one copy of the floors. The override branches moved into the shared evaluator (checkDoneFloors passes {}), which departs from the plan's 'left in _doneImpl'. | task-skill-implement-extract-checkdonefloors-and-wire-the |
| AC-AP-10 | 85 | 5+ tests pass with attestation. archiveSweepCandidate and --sweep share checkSweepCandidateFloor, and the straggler case was re-baselined. The AC statement is truncated in the materials, so the full criterion could not be checked. | task-skill-implement-archive-apply-honours-the-done-floor-port |

## Gaps

- The verification task claims full test:vitest and test:bun runs on main, but its evidence holds only the AC-AP commands. R1 names 36 affected test files and only about 9 have pass rows.
- Typecheck on main first failed with a merge-conflict marker in packages/lore/tests/e2e/issue-check.bun.test.ts. A later run passed, but nothing records the resolution.
- ApprovalPort in packages/lore/src/service/corpus-service.ts passes only reviewer and expectedVersion. The plan asked for the WriteActorOpts set() received (attribution).
- packages/lore/tests/unit/service/tiered-review.test.ts wires setApprovalPort through an 'as unknown as' cast left over from the RED phase, not the typed API.

## Recommendations

- Require the verification task to attach captured full-suite runs and the leaf grep output before it can be archived.
- Run typecheck as a pre-merge check on every RED+implement merge so conflict markers cannot reach main.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 46606ms
- Retried: false
- Truncated sections: spec, diff:packages/lore/tests/unit/service/plan-close-cascade-plan-membership.test.ts, diff:packages/lore/tests/unit/service/check-done-floors.test.ts, diff:packages/lore/tests/integration/set-approval-gate-parity-surfaces.bun.test.ts, diff:packages/lore/tests/integration/set-approval-gate-parity.bun.test.ts, diff:packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | Diff shows set delegation, the done-floor extraction, cascade and sweep port use, and human output. All 10 ACs have attested passes on main. |
| evidence_integrity | 72 | 0.6 | evidence | All rows are attested, but full-suite and leaf-edit evidence is missing, a typecheck fail came from a conflict marker, and some implement-task expected-fail rows were made later in scratch dirs. |
| scope_fidelity | 82 | 0.65 | evidence | Mostly on plan. The override branches moved into the shared evaluator, and the approval port omits attribution options. The extra routes.ts If-Match change was needed for AC-AP-2(e). |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The verification task claims full test:vitest and test:bun runs on main, but its evidence holds only the AC-AP commands. R1 names 36 affected test files and only about 9 have pass rows. |
| evidence_integrity | minor | AC-AP-8 | Typecheck on main first failed with a merge-conflict marker in packages/lore/tests/e2e/issue-check.bun.test.ts. A later run passed, but nothing records the resolution. |
| scope_fidelity | minor | AC-AP-2 | ApprovalPort in packages/lore/src/service/corpus-service.ts passes only reviewer and expectedVersion. The plan asked for the WriteActorOpts set() received (attribution). |
| outcome | minor | AC-AP-3 | packages/lore/tests/unit/service/tiered-review.test.ts wires setApprovalPort through an 'as unknown as' cast left over from the RED phase, not the typed API. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the verification task to attach captured full-suite runs and the leaf grep output before it can be archived. | The plan's invariants and R1 mitigation depend on these runs, and they are not evidenced. |
| process | Run typecheck as a pre-merge check on every RED+implement merge so conflict markers cannot reach main. | I1 was broken once. |

## Unverifiable Materials

- set-approval-gate-parity*.bun.test.ts, check-done-floors.test.ts, plan-close-cascade-plan-membership.test.ts: Omitted from the diff, so per-case assertions could not be inspected.
- AC-AP-10 full statement: Truncated in the materials.
- Removal of the set-local spec-promote/BR-1007 blocks: Not shown in the diff. The early return makes them unreachable on the port path.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 3

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 9 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
