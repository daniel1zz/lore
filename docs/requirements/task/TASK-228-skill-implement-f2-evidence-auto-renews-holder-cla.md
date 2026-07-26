---
id: TASK-228
type: task
role: plan
title: "[Skill:implement] F2 — evidence auto-renews holder claim (core renewClaimForEvidence + task/phase services)"
status: archived
priority: high
phase: "Phase 1: Implementation"
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: PLAN-051
plan: PLAN-051
links:
  - {id: TASK-230, type: blocks}
---
Estimate: M
Approach: Pure fn renewClaimForEvidence(claim, actor, nowIso): TaskClaim | null in packages/core/src/task-workflow.ts (beside extractClaim/isClaimStale; returns a NEW claim object {...claim, at: nowIso} on same-holder match — fresh OR stale — else null; never mutates input). Wire into BOTH TaskWorkflowService.appendEvidenceEntry and PhaseWorkflowService.appendEvidenceEntry: after evidence validation, call with the ALREADY-CAPTURED nowIso (never a second now() invocation); non-null -> fold refreshed claim into the same newExtra passed to writeTaskExtra/writePhaseExtra, and add claim_renewed: true to the audit details object. Revise task-workflow-service.ts module-header @invariant text to declare the bounded same-holder claim.at side-effect (and mirror the note in phase-workflow-service.ts header).
Source: spec-069 Design Decisions D4/D5 + Module Boundary implementation constraints
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-069-3, AC-069-4, AC-069-5

AC:
- renewClaimForEvidence truth table (core test): same-holder fresh -> renewed with at === nowIso and branch/machine/worktree preserved; same-holder stale -> renewed; foreign holder -> null; undefined claim -> null; input object unmutated (toStrictEqual snapshot before/after)
- TaskWorkflowService.addEvidence with same-holder claim: doc version delta === 1, evidence appended AND claim.at === evidence recorded_at, audit entry details.claim_renewed === true
- TaskWorkflowService.addEvidence with foreign-holder claim: extra.claim deep-equal to pre-call value; no claim_renewed key in audit details
- TaskWorkflowService.addEvidence with no claim: extra.claim stays absent
- Existing STALE_VERSION now()-seam recipe test still passes UNMODIFIED (run the existing task-workflow suite scoped)
- PhaseWorkflowService parity: same-holder renewal + single version bump + foreign-holder untouched on a phase doc target
- Scoped oracles green in worktree: bunx vitest run packages/lore/tests/unit/core/renew-claim-for-evidence.test.ts packages/lore/tests/unit/service/task-workflow-evidence-renewal.test.ts packages/lore/tests/unit/service/phase-workflow-evidence-renewal.test.ts packages/lore/tests/unit/service/task-workflow-service.test.ts packages/lore/tests/unit/service/phase-workflow-service.test.ts (assert matched count == 5) + bun run typecheck
