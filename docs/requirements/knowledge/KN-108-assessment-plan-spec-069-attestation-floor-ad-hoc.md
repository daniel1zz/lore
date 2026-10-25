---
id: KN-108
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-069 attestation floor + ad-hoc task channel (2026-07-23)"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-10-23
tags: []
parent: PLAN-055
links:
  - {id: PLAN-055, type: informs}
---
> ⚠ INVALIDATED 2026-07-23T14:52:14.561Z; diff range a280962..HEAD was contaminated by concurrent-session commits (SPEC-068 hotfix + 'SPEC-069 F2') — major scope_fidelity gap is false drift; superseded by exact --diff-file rerun

# Assessment: met (86/100)

Scope: plan `01KY6S0GQ5ZHMXJ7ER92QFQZY5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-069-1 | 90 | 3 attested passing runs of attestation-floor.test.ts -t AC-069-1 with output tails. Diff shows attestationFloor wired into checkPlanClose as an opt-out predicate and feedAttestationFloor names offending tasks and the literal 'lore verify' recovery string, matching the AC's denial-message requiremen… | 01KY6S21R745E27B488XJTE8Z9 (T1 attested test evidence [3]), 01KY6S27KK0RB100ZGWCK1MHPX (T3 attested run [4]) |
| AC-069-2 | 90 | 3 attested passing runs of -t AC-069-2. checkPlanClose pushes both predicates without short-circuit, so a plan meeting the floor passes; the specific close-succeeds transition behavior lives in test/service code, evidenced by the attested runs. | 01KY6S21R745E27B488XJTE8Z9 (T1 attested run [4]) |
| AC-069-3 | 90 | 3 attested passing runs (each run shows 2 tests passing under -t AC-069-3, consistent with default-0.5-fails + knob-0.3-passes pair). Diff shows workflow.attestation.min_ratio schema (default 0.5, bounds 0..1) and resolveAttestationMinRatio with defensive optional chaining. | 01KY6S21R745E27B488XJTE8Z9 (T1 attested run [5]; config.ts knob in diff) |
| AC-069-4 | 88 | 3 attested passing runs of -t AC-069-4. Diff shows attestationExempt short-circuit in checkPlanClose and extractAttestationExemption feeding attestation_exemption into computeAssessmentFacts, matching both halves (exempt close + assess-facts surfacing). Reason-required enforcement lives in unseen c… | 01KY6S21R745E27B488XJTE8Z9 (T1 attested run [6]), 01KY6S27KK0RB100ZGWCK1MHPX (T3 attested run [7]) |
| AC-069-5 | 88 | 3 attested + 1 self-reported passing runs of adhoc-task.test.ts -t AC-069-5 (17 tests matching). Diff shows --adhoc flag, checkTaskCreateAdhocConflicts exit-2 path for --adhoc+--plan-id, schema superRefine relaxing plan_id, and extra.adhoc=true. Root-PRD parenting is in unseen corpus-service.ts. | 01KY6S24VSYCMNJH1NH52EV0HH (T2 attested run [7]) |
| AC-069-6 | 88 | 3 attested + 1 self-reported passing runs of -t AC-069-6. Diff shows --linkage stored verbatim in extra.linkage (explicitly no trim) and task_linkage populated in computeAssessmentFacts from extractTaskLinkage — both halves of the AC visible in production code plus attested tests. | 01KY6S24VSYCMNJH1NH52EV0HH (T2 attested run [8]), 01KY6S27KK0RB100ZGWCK1MHPX (T3 evidence [2]) |
| AC-069-7 | 85 | 3 attested + 1 self-reported passing runs of -t AC-069-7 (9 tests matching). ready.ts diff shows mutually-exclusive --adhoc mode piping TaskWorkflowService.readyAdhoc with --json output; plan-mode path structurally unchanged. readyAdhoc itself is in unseen task-workflow-service.ts; regression pin r… | 01KY6S27KK0RB100ZGWCK1MHPX (T3 attested run [10]) |

## Gaps

- The diff contains four work streams absent from the plan's goal/phases/tasks: session-derived actor identity (session-actor.ts, utils.ts session tier), evidence-triggered claim renewal (task-workflow.ts renewClaimForEvidence), bootstrap last_activity_at (session.ts, bootstrap.ts), and the SPEC-068 pinyin bun-compile hotfix (slugify-node.ts, node.ts, export-docs-service.ts). Each cites SPEC-069/068 rationale in comments, but the plan itself declares none of them.
- All three tasks are status=draft despite complete attested evidence; the workflow state lags the actual work, which is exactly the kind of inconsistency this spec's own gates exist to catch.
- The two test files carrying all AC evidence (attestation-floor.test.ts, adhoc-task.test.ts) and the service files with the enforcement wiring (corpus-service.ts, task-workflow-service.ts, gate-predicates.ts) are omitted from the reviewable diff, so assertion depth vs AC statements rests on the attested runs alone.
- Plan goal says 'Implement SPEC-068' and the T2 task slug embeds 'ac-068-5-6' while all ACs are AC-069-*; identifier drift between plan prose and spec.
- Zero knowledge docs linked despite a nontrivial root-caused defect (createRequire breaking under bun build --compile) documented only in code comments.

## Recommendations

- Retroactively attach the four undeclared work streams (session actor, claim renewal, last_activity_at, pinyin hotfix) to tasks — using --linkage for justified attachments or --adhoc for the hotfix — or split them into a follow-up plan.
- Move the three draft tasks to their evidenced-complete status before invoking plan-close, and run lore verify against the plan so the new attestation floor is exercised on its own delivery.
- Record a knowledge doc for the bun build --compile literal-specifier dynamic-import constraint (createRequire fails from $bunfs/root).
- Correct 'SPEC-068' to 'SPEC-069' in the plan goal and fix the ac-068-5-6 fragment in the T2 task slug.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 67583ms
- Retried: false
- Truncated sections: diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/migration-service.ts, diff:packages/lore/src/service/phase-migration-service.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/session-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/integration/cli/slugify-compiled.bun.test.ts, diff:packages/lore/tests/unit/cli/actor-session-tier.test.ts, diff:packages/lore/tests/unit/core/barrel-isolation.test.ts, diff:packages/lore/tests/unit/core/renew-claim-for-evidence.test.ts, diff:packages/lore/tests/unit/core/session-actor.test.ts, diff:packages/lore/tests/unit/core/slugify-adversarial.test.ts, diff:packages/lore/tests/unit/core/slugify-cjk.test.ts, diff:packages/lore/tests/unit/service/adhoc-task.test.ts, diff:packages/lore/tests/unit/service/attestation-floor.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-evidence-renewal.test.ts, diff:packages/lore/tests/unit/service/session-bootstrap-last-activity.test.ts, diff:packages/lore/tests/unit/service/set-slug-adversarial.test.ts, diff:packages/lore/tests/unit/service/task-workflow-evidence-renewal.test.ts
- Reasoning clipped for: AC-069-1, AC-069-4, AC-069-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.85 | evidence | All 7 ACs have 3+ attested passing script runs; diff shows matching production code for every AC (predicate, knob, exemption, adhoc CLI, linkage facts, ready --adhoc). |
| evidence_integrity | 84 | 0.8 | evidence | Attested per-AC vitest runs with output tails, tsc passes, 0.75 attested ratio. Test bodies unseen (truncated) so assertion depth unverified; tasks still draft. |
| scope_fidelity | 60 | 0.75 | evidence | Core work matches declared scope, but session-actor, claim renewal, last_activity_at, and a SPEC-068 pinyin hotfix ride along outside the plan's two declared phases, unnamed by any task. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | The diff contains four work streams absent from the plan's goal/phases/tasks: session-derived actor identity (session-actor.ts, utils.ts session tier), evidence-triggered claim renewal (task-workflow.ts renewClaimForEvidence), bootstrap last_activity_at (session.ts, bootstrap.ts), and the SPEC-068 pinyin bun-compile hotfix (slugify-node.ts, node.ts, export-docs-service.ts). Each cites SPEC-069/068 rationale in comments, but the plan itself declares none of them. |
| evidence_integrity | minor | — | All three tasks are status=draft despite complete attested evidence; the workflow state lags the actual work, which is exactly the kind of inconsistency this spec's own gates exist to catch. |
| evidence_integrity | minor | — | The two test files carrying all AC evidence (attestation-floor.test.ts, adhoc-task.test.ts) and the service files with the enforcement wiring (corpus-service.ts, task-workflow-service.ts, gate-predicates.ts) are omitted from the reviewable diff, so assertion depth vs AC statements rests on the attested runs alone. |
| scope_fidelity | minor | — | Plan goal says 'Implement SPEC-068' and the T2 task slug embeds 'ac-068-5-6' while all ACs are AC-069-*; identifier drift between plan prose and spec. |
| outcome | minor | — | Zero knowledge docs linked despite a nontrivial root-caused defect (createRequire breaking under bun build --compile) documented only in code comments. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Retroactively attach the four undeclared work streams (session actor, claim renewal, last_activity_at, pinyin hotfix) to tasks — using --linkage for justified attachments or --adhoc for the hotfix — or split them into a follow-up plan. | The plan's assess facts will otherwise flag exactly the silent drift this SPEC's D3 linkage mechanism was built to eliminate. |
| process | Move the three draft tasks to their evidenced-complete status before invoking plan-close, and run lore verify against the plan so the new attestation floor is exercised on its own delivery. | Dogfooding the gate on the plan that ships it is the cheapest end-to-end validation available. |
| process | Record a knowledge doc for the bun build --compile literal-specifier dynamic-import constraint (createRequire fails from $bunfs/root). | Probe-verified, non-obvious platform behavior currently persisted only in a file header comment. |
| plan | Correct 'SPEC-068' to 'SPEC-069' in the plan goal and fix the ac-068-5-6 fragment in the T2 task slug. | Identifier drift between plan and spec undermines traceability tooling that keys on spec ids. |

## Unverifiable Materials

- packages/lore/tests/unit/service/attestation-floor.test.ts and adhoc-task.test.ts contents: Omitted per truncation manifest — attested runs confirm they pass, but whether assertions fully pin each AC statement (e.g. denial names an offending task) could not be read directly.
- packages/lore/src/service/corpus-service.ts, task-workflow-service.ts, gate-predicates.ts: Omitted per truncation manifest — plan-close wiring, readyAdhoc, root-PRD parenting, and the attestationFloor predicate body are referenced by the diff but unseen.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.75
