---
id: KN-377
type: knowledge
role: knowledge
title: "Assessment: Implementation — tiered review (SPEC-103) (2026-07-28)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-109
links:
  - {id: PLAN-109, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01KYKX7S3AHCX5ER8R9B7W8X16`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TIER-1 | 86 | Attested vitest run (agent:main-orchestrator) plus self-reported T1 run, both pass, 0 fail. Output tail shows 6 passed/9 skipped under the -t filter. Implementation of fast-track write + audit row unverifiable without diff. | task-t1-service-ledger-fast-track-ai-provenance-config-keys (self-reported [1]), task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [7]) |
| AC-TIER-2 | 85 | Attested run shows 2 passed/13 skipped, 0 fail. Covers atomic reset + re-fast-track vs spec reset-to-draft per test names only; atomicity of the write is asserted by the test, not independently verifiable here. | task-t1-service-ledger-fast-track-ai-provenance-config-keys (self-reported [2]), task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [8]) |
| AC-TIER-3 | 82 | Attested run passes but shows only 1 passed/14 skipped for a two-part AC (default excludes task+ledger sub_types AND --all restores). Single matched test may under-cover the --all half. | task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [9]; self-reported [1]) |
| AC-TIER-4 | 90 | Attested bun integration run names both halves: exit-4 deny naming lore review, and approve succeeding after a fresh current-version judgment. 2 pass, 0 fail, 5 expect() calls. | task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [11]... AC-TIER-4 at [10]) |
| AC-TIER-5 | 84 | Attested run names all three sub-cases (no outroll on version N, version bump approves, --override-judgment with audit row). Output tail is truncated before the pass/fail summary, so 0-fail is asserted by the record, not shown. | task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [11], tail clipped) |
| AC-TIER-6 | 86 | Attested vitest run: 4 passed/11 skipped, 0 fail; AC split across T1 (provenance write) and T2 (tuple-collision deny), both evidenced. Actual provenance tuple shape unverifiable without diff. | task-t1-service-ledger-fast-track-ai-provenance-config-keys (self-reported [3]), task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [12]) |
| AC-TIER-7 | 74 | Attested run passes (2 passed/13 skipped). But 'byte-identical' legacy reproduction is a strong equivalence claim backed by two unit tests with no visible assertions or diff; scored conservatively. | task-t1-service-ledger-fast-track-ai-provenance-config-keys (self-reported [4]), task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [13]) |
| AC-TIER-8 | 88 | Attested bun run: 1 pass, 0 fail, 11 expect() calls, test name covers both one-shot fast-track and zero-change second run. Idempotence exercised in-process only. | task-t2-gate-cli-judgment-required-promote-worst-decision-wins (attested [14]) |

## Gaps

- diff_available=false and tests_touched=false. Nothing in the bundle shows which files changed, so the plan's anchor constraints (corpus-service.ts, gate-enforcer.ts, adapters/cli) and the sequential T1→T2 single-worktree rule cannot be confirmed.
- Task T1 has attested_count=0 (5 self-reported entries). Its ACs (TIER-1/2/6/7) are attested only through re-runs logged on T2, so the implementing agent's own claims for the M1 service work are unwitnessed.
- 'Byte-identically reproduce legacy behavior' is the strongest claim in the spec and is backed by two unit tests whose assertions are not visible. No golden-output or snapshot artifact is included.
- The attested vitest run for AC-TIER-3 reports 1 passed / 14 skipped, while the AC has two clauses (pending default excludes task+ledger sub_types; --all restores). Coverage of the --all clause is not visibly separated.
- Evidence [11] output_tail cuts off after the three test lines, omitting the 'N pass / 0 fail' summary. The pass verdict rests on the record's result field rather than the captured output.

## Recommendations

- Require the diff (or at least a changed-file list with per-file line counts) in the audit bundle before a plan is eligible for a 'met' verdict.
- Require at least one attested oracle run recorded on each task, not just on the terminal task of a sequential chain.
- Restate AC-TIER-7 with a concrete equivalence oracle (snapshot of audit rows + status transitions under legacy config) instead of the phrase 'byte-identically'.
- Add a knowledge-capture task covering the new workflow.review.* config keys, --override-judgment audit semantics, and the backfill-ledger verb.
- Capture oracle output through the final summary line; treat a tail missing the pass/fail count as incomplete evidence.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 64372ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All 8 ACs have passing script oracles, each with at least one attested run and zero fails; typecheck passes. Depth of implementation unverifiable without a diff. |
| evidence_integrity | 76 | 0.72 | evidence | Every AC independently re-run and attested by agent:main-orchestrator with output tails. Weakened by 0.42 attested ratio, T1 fully self-reported, and one truncated tail (AC-TIER-5). |
| scope_fidelity | 68 | low | absence | Task titles map cleanly to plan phases P1/P2 and no out-of-scope ACs appear, but with no diff and no ac_scope declaration, drift in touched files cannot be checked. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | diff_available=false and tests_touched=false. Nothing in the bundle shows which files changed, so the plan's anchor constraints (corpus-service.ts, gate-enforcer.ts, adapters/cli) and the sequential T1→T2 single-worktree rule cannot be confirmed. |
| evidence_integrity | major | — | Task T1 has attested_count=0 (5 self-reported entries). Its ACs (TIER-1/2/6/7) are attested only through re-runs logged on T2, so the implementing agent's own claims for the M1 service work are unwitnessed. |
| outcome | minor | AC-TIER-7 | 'Byte-identically reproduce legacy behavior' is the strongest claim in the spec and is backed by two unit tests whose assertions are not visible. No golden-output or snapshot artifact is included. |
| outcome | minor | AC-TIER-3 | The attested vitest run for AC-TIER-3 reports 1 passed / 14 skipped, while the AC has two clauses (pending default excludes task+ledger sub_types; --all restores). Coverage of the --all clause is not visibly separated. |
| evidence_integrity | minor | AC-TIER-5 | Evidence [11] output_tail cuts off after the three test lines, omitting the 'N pass / 0 fail' summary. The pass verdict rests on the record's result field rather than the captured output. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the diff (or at least a changed-file list with per-file line counts) in the audit bundle before a plan is eligible for a 'met' verdict. | Every quality judgment here rests on test names; implementation correctness beyond green oracles is unverifiable. |
| process | Require at least one attested oracle run recorded on each task, not just on the terminal task of a sequential chain. | T1 shipped with 0 attested runs; attestation ratio 0.42 despite full AC coverage. |
| spec | Restate AC-TIER-7 with a concrete equivalence oracle (snapshot of audit rows + status transitions under legacy config) instead of the phrase 'byte-identically'. | Unfalsifiable phrasing invites a test that passes without proving equivalence. |
| plan | Add a knowledge-capture task covering the new workflow.review.* config keys, --override-judgment audit semantics, and the backfill-ledger verb. | 0 linked knowledge docs for a change that adds operator-facing config, a CLI verb, and a gate escape hatch. |
| process | Capture oracle output through the final summary line; treat a tail missing the pass/fail count as incomplete evidence. | AC-TIER-5's tail is clipped mid-output, so its 0-fail claim is unwitnessed. |

## Unverifiable Materials

- Implementation diff (corpus-service.ts, gate-enforcer.ts, adapters/cli, config schema): Bundle states 'no diff provided'; diff_available=false. Cannot confirm which files changed or that anchors stayed within plan scope.
- Test file contents (tiered-review.test.ts, tiered-review-gate.bun.test.ts): Only test names and pass counts are visible; assertion strength and red-first claim cannot be checked.
- Plan precondition that plan-implementation-trace-layer-spec-102 merged to main first: No evidence record, branch state, or merge reference in the bundle.
- AC-TIER-5 full oracle output: output_tail truncated before the pass/fail summary line.
- Knowledge documentation for new config keys and CLI verb: 0 linked knowledge docs reported by the bundle.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.42
