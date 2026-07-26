---
id: KN-136
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-069 attestation floor + ad-hoc task channel (2026-07-23)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-055
links:
  - {id: PLAN-055, type: informs}
---
# Assessment: met (90/100)

Scope: plan `01KY6S0GQ5ZHMXJ7ER92QFQZY5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-069-1 | 95 | 3 attested passes, 0 fails. Shown test asserts denial at archive with field gate:plan-close:attestation-floor, message containing the offending task slug and 'lore verify'. Implementation (attestationFloor + feedAttestationFloor) visibly produces both. | 01KY6S21R745E27B488XJTE8Z9 (attested vitest runs of attestation-floor.test.ts -t AC-069-1) |
| AC-069-2 | 95 | 3 attested passes. Shown test archives the same plan shape once evidence carries an attestation object; predicate logic (per-task attested>=1 AND ratio>=floor) confirms the transition succeeds. | 01KY6S21R745E27B488XJTE8Z9 (attested AC-069-2 runs (1 passed)) |
| AC-069-3 | 95 | 3 attested passes (2 tests match the filter, consistent with the shown file: 0.4 ratio fails default 0.5, passes at configured 0.3). Config knob workflow.attestation.min_ratio wired via WorkflowConfigSchema + resolveAttestationMinRatio + GateEnforcer seam. | 01KY6S21R745E27B488XJTE8Z9 (attested AC-069-3 runs (2 passed | 8 skipped)) |
| AC-069-4 | 92 | 3 attested passes (3 matching tests incl. no-reason and whitespace-reason negatives). Exemption close path fully shown; the 'assess facts surface the exemption' half lives in assessment.ts (extractAttestationExemption, always-populated attestation_exemption) and is verified by the unseen adhoc-task… | 01KY6S21R745E27B488XJTE8Z9 (attested AC-069-4 runs (3 passed | 7 skipped)) |
| AC-069-5 | 88 | 4 passes (3 attested), 0 fail. CLI --adhoc flag, exit-2 conflict path (checkTaskCreateAdhocConflicts, conflicts checked before missing-flags), schema superRefine relaxation, and root-PRD auto-parenting in CorpusService are all visible in the diff. Test file itself omitted (present but unseen). | 01KY6S24VSYCMNJH1NH52EV0HH (attested adhoc-task.test.ts -t AC-069-5 runs (17 passed | 16 skipped)) |
| AC-069-6 | 88 | 4 passes (3 attested), 0 fail. --linkage stored verbatim (buildExtra, no trim), taskExtraSchema.linkage, and assess facts surfacing via task_linkage in computeAssessmentFacts all shown in diff; assertions live in the omitted-but-present test file. | 01KY6S27KK0RB100ZGWCK1MHPX (attested adhoc-task.test.ts -t AC-069-6 runs (7 passed | 26 skipped)) |
| AC-069-7 | 88 | 4 passes (3 attested), 0 fail. readyAdhoc reuses evaluateReadiness with terminal-status filtering; ready.ts adds --adhoc with mutual-exclusion exit 2 and {data:{adhoc:{records}}} JSON. Plan-mode path is code-untouched beyond arg plumbing; regression assertions are in the unseen test file. | 01KY6S27KK0RB100ZGWCK1MHPX (attested adhoc-task.test.ts -t AC-069-7 runs (9 passed | 24 skipped)) |

## Gaps

- adhoc-task.test.ts — the only assertion source for AC-069-5/6/7 — is omitted from the audit bundle; pass results are attested but assertion strength (e.g. verbatim linkage storage, root-PRD parenting, plan-mode regression checks) cannot be inspected.
- Plan is titled/goal'd as SPEC-068 while the spec, ACs (AC-069-*), and all code comments reference SPEC-069; task T2's slug embeds 'ac-068-5-6'. Traceability noise, no functional impact.
- All three tasks are still status=draft despite full attested evidence — the corpus lifecycle state does not yet reflect completed, verified work.

## Recommendations

- Fix the SPEC-068→SPEC-069 numbering in the plan title, goal line, and task T2's slug, then advance the three draft tasks to their post-verification status.
- When bundling audits, always include test files that are the sole verifier for multiple ACs, or attach an assertion summary when they must be truncated.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 56696ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/adhoc-task.test.ts
- Reasoning clipped for: AC-069-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 92 | 0.85 | evidence | All 7 script ACs have attested passes, 0 fails; shown diff and attestation-floor tests directly implement/verify D1-D4 behavior end-to-end at the service layer. |
| evidence_integrity | 85 | 0.8 | evidence | Every AC re-run and attested by the orchestrator (3 attested passes each, 0 fails); skipped/passed counts match the shown test file. Ratio 0.75 due to earlier self-reported subagent entries. |
| scope_fidelity | 87 | 0.75 | evidence | Diff stays on SPEC-069 scope (gate, config, schema, CLI, ready/assess); no unrelated changes visible. Deduction for SPEC-068/069 numbering drift in plan/task naming and draft task statuses. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-069-5 | adhoc-task.test.ts — the only assertion source for AC-069-5/6/7 — is omitted from the audit bundle; pass results are attested but assertion strength (e.g. verbatim linkage storage, root-PRD parenting, plan-mode regression checks) cannot be inspected. |
| scope_fidelity | minor | — | Plan is titled/goal'd as SPEC-068 while the spec, ACs (AC-069-*), and all code comments reference SPEC-069; task T2's slug embeds 'ac-068-5-6'. Traceability noise, no functional impact. |
| outcome | minor | — | All three tasks are still status=draft despite full attested evidence — the corpus lifecycle state does not yet reflect completed, verified work. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Fix the SPEC-068→SPEC-069 numbering in the plan title, goal line, and task T2's slug, then advance the three draft tasks to their post-verification status. | Numbering drift and stale draft statuses undermine corpus traceability for a spec whose whole point is evidence integrity. |
| process | When bundling audits, always include test files that are the sole verifier for multiple ACs, or attach an assertion summary when they must be truncated. | Three of seven ACs here were judgeable only via attested pass counts, not assertion content. |

## Unverifiable Materials

- packages/lore/tests/unit/service/adhoc-task.test.ts: Omitted per truncation manifest (present but unseen) — assertion content for AC-069-5/6/7 could not be reviewed, only its attested pass/skip counts.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.75
