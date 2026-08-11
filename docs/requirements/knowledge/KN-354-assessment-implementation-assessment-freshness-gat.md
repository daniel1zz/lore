---
id: KN-354
type: knowledge
role: knowledge
title: "Assessment: Implementation — assessment freshness gate (SPEC-106) (2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-110
links:
  - {id: PLAN-110, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KYMFDAB067MAMMTWKTCSS3GD`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-FRESH-1 | 92 | Two attested + two self-reported passes. Unit test drives a real CorpusService.set→archived denial, asserts field gate:plan-close:assessment-freshness and that the message names `lore assess <slug>` plus both compared timestamps. Only the evidence half of 'evidence/done' is exercised. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [3],[9],[14] -t AC-FRESH-1) |
| AC-FRESH-2 | 93 | 4 tests pass under the filter: newer assessment restores closeability, no-assessment plan closes despite activity, assessment+zero-activity and zero-task cases are vacuous passes. Predicate's undefined handling also unit-tested directly. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [4],[10],[15]) |
| AC-FRESH-3 | 84 | Test does anchor add, link write and status change after an assessment and still closes; those ops emit update/link audit rows, so it genuinely discriminates against an updated_at implementation. But no test proves a `done` audit row DOES trip it, so the details.done branch is unverified. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [5],[11],[16]) |
| AC-FRESH-4 | 90 | bun integration test spawns the compiled binary over a tmp corpus: first assess is warning-free, second (after real `lore evidence`) exits 0, writes a 2nd assessment doc, and stderr names both facts. Cross-validates the real informs/sub_type read path. Timestamp values themselves not asserted. | 01KYMFDPGN8A3S4FSBC06629AR (evidence [6],[12],[17]) |
| AC-FRESH-5 | 92 | 3 tests: flag+non-empty reason archives cleanly; bare flag still denied with the freshness field; whitespace-only reason also denied. Resolver in corpus-service matches (=== true && trimmed length > 0). | 01KYMFDPGN8A3S4FSBC06629AR (evidence [7],[13],[18]) |

## Gaps

- resolveNewestTaskActivityAt treats action==='update' && details.done===true as activity, but no test exercises a real TaskWorkflowService.done write. Since 'done' shares the generic 'update' action label with ordinary status writes, a drift in that details key would silently disable half the predicate and every existing test would still pass.
- The staleness advisory in assess.ts sets process.exitCode and returns when getAssessmentFreshness fails, so a store/resolve error on the advisory path aborts the assessment write. D3 says lore assess is the remedy and must never refuse; the comment acknowledges this as IO-failure handling, but it is an untested path where the command can refuse.
- attested_evidence_ratio 0.56; the attested runs are the identical vitest/bun commands replayed by agent:main-orchestrator in the main worktree. That confirms the tests are not worktree-local but adds no independent oracle. No full-suite regression run is evidenced for a diff that rewrites plan-close's feeding-message dispatch.
- feedPlanClose gained an appended assessmentNote at three branches (prdSync-only, attestation-only, attestation+prdSync, uat). Only the attestation+freshness branch has a regression test; the prdSync+freshness and uat+freshness message shapes are unverified.

## Recommendations

- Add a plan-close test whose newest audit row comes from TaskWorkflowService.done (action 'update', details.done true) and assert the denial, plus a negative control where a plain `set --status` update after the assessment does NOT deny.
- Extend the feeding-pack regression suite to the prdOutlineSynced+freshness and uatP0Accepted+freshness combinations.
- Require a full-suite (not just test:changed) run as evidence when a change edits a shared gate feeding-message dispatcher.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 72727ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.82 | evidence | All five ACs have passing script evidence backed by a coherent diff: predicate, GateContext fields, shared CorpusService resolver, feeding pack, CLI advisory, exemption. Done-branch untested. |
| evidence_integrity | 82 | 0.75 | evidence | 18 evidence rows, tsc+test oracles, output tails included and consistent with the tests in the diff. Attestation is orchestrator re-runs of the same commands; no full-suite run. |
| scope_fidelity | 92 | 0.85 | evidence | Additive predicate on the existing plan-close checkpoint as planned; no new checkpoint, no unrelated files. Minor unstated extension: phase docs are folded into the task activity scan. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-FRESH-3 | resolveNewestTaskActivityAt treats action==='update' && details.done===true as activity, but no test exercises a real TaskWorkflowService.done write. Since 'done' shares the generic 'update' action label with ordinary status writes, a drift in that details key would silently disable half the predicate and every existing test would still pass. |
| outcome | minor | AC-FRESH-4 | The staleness advisory in assess.ts sets process.exitCode and returns when getAssessmentFreshness fails, so a store/resolve error on the advisory path aborts the assessment write. D3 says lore assess is the remedy and must never refuse; the comment acknowledges this as IO-failure handling, but it is an untested path where the command can refuse. |
| evidence_integrity | minor | — | attested_evidence_ratio 0.56; the attested runs are the identical vitest/bun commands replayed by agent:main-orchestrator in the main worktree. That confirms the tests are not worktree-local but adds no independent oracle. No full-suite regression run is evidenced for a diff that rewrites plan-close's feeding-message dispatch. |
| outcome | minor | — | feedPlanClose gained an appended assessmentNote at three branches (prdSync-only, attestation-only, attestation+prdSync, uat). Only the attestation+freshness branch has a regression test; the prdSync+freshness and uat+freshness message shapes are unverified. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a plan-close test whose newest audit row comes from TaskWorkflowService.done (action 'update', details.done true) and assert the denial, plus a negative control where a plain `set --status` update after the assessment does NOT deny. | The done discriminator is the fragile half of D2 and is currently unverified in either direction. |
| plan | Extend the feeding-pack regression suite to the prdOutlineSynced+freshness and uatP0Accepted+freshness combinations. | Three edited dispatch branches ship with one tested; message wording is what agents act on. |
| process | Require a full-suite (not just test:changed) run as evidence when a change edits a shared gate feeding-message dispatcher. | test:changed scoped to one commit can miss downstream message assertions in unrelated gate suites. |

## Unverifiable Materials

- TaskWorkflowService.done's actual audit-row shape: Not in the diff; the claim that it writes action 'update' with details.done===true is asserted only in JSDoc and never exercised by a test.
- Full test suite / broader regression state: Only typecheck and `test:changed <sha>` are evidenced; no repo-wide run appears in the evidence trail.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.56
