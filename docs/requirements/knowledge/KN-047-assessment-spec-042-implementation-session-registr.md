---
id: KN-047
type: knowledge
role: knowledge
title: "Assessment: SPEC-042 Implementation — session registry + file-anchor claim safety (2026-07-11)"
status: archived
priority: medium
created: 2026-07-11
updated: 2026-10-23
tags: []
parent: PLAN-026
links:
  - {id: PLAN-026, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KX7G3V3AQFSGJ4WFVNR55PZG`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-S3-1 | 93 | file-anchors.test.ts 26 tests pass (attested). Diff shows normalizeFileAnchors/anchorsOverlap with segment-boundary, trailing-slash, dedup, case-sensitive, empty-side, precondition-only contract all implemented. | 01KX7G4GA44M4DH87N0MMRN599 (26/26 pass) |
| AC-S3-2 | 92 | claim-anchor-gate.test.ts 17 tests pass (attested twice). Gate emits field gate:task-claim:anchor-overlap with recovery command per plan/diff. | 01KX7G4GA44M4DH87N0MMRN599 |
| AC-S3-3 | 91 | Same suite covers pass/block matrix incl. no-spec-ancestor short-circuit and discriminator separation; 17/17 attested pass. | 01KX7G4GA44M4DH87N0MMRN599 |
| AC-S3-4 | 92 | claim-session-fields.test.ts 11 tests pass (attested). buildTaskClaim carry-forward/override/fresh-start and legacy regression visible in diff. | 01KX7G4GA44M4DH87N0MMRN599 |
| AC-S3-5 | 91 | file-anchors-validation.test.ts 18 tests pass (attested). Create-time + addAnchors/removeAnchors RMW preserving claim/evidence; all rejection cases enumerated in normalizeFileAnchors. | 01KX7G4GA44M4DH87N0MMRN599 |
| AC-S3-6 | 91 | session-registry.test.ts 14 tests pass (attested). deriveSessions composite key (by,machine,worktree), legacy machine-less grouping, staleness filter, anchorless advisory in diff. | 01KX7G4GA44M4DH87N0MMRN599 |
| AC-S3-8 | 88 | mcp-session-registry.test.ts 8 tests pass (attested). MCP tools.ts truncated but claim/anchor_set/ready/bootstrap parity asserted by suite. | 01KX7G4GDNY3P0622HBHM4Z91R |
| AC-S3-9 | 91 | tree-claim-badge.test.ts 10 tests pass (attested). formatWorkflowBadge appends @branch when present; stale/evidence unchanged in utils.ts diff. | 01KX7G4GDNY3P0622HBHM4Z91R |
| AC-S3-10 | 90 | session-registry.test.ts covers boundary/schema-drift; bootstrapReportSchema.active_sessions declared on schema (Zod strip regression) visible in diff. 14/14 attested pass. | 01KX7G4GA44M4DH87N0MMRN599 |
| AC-S3-11 | 90 | claim-anchor-gate.test.ts (17 pass) covers steal-still-blocks, release-then-succeeds, keep-alive grouping stability. | 01KX7G4GA44M4DH87N0MMRN599 |
| AC-S3-7 | 89 | cli-claim-anchors.bun.test.ts 13 pass / 37 expects (attested). Covers create --anchor, add/rm/list, exit-4 validation, machine override vs os.hostname(), no-cwd worktree, anchor-overlap block. | 01KX7G4GDNY3P0622HBHM4Z91R (13 pass) |
| AC-S3-12 | 78 | Human/manual dual-session UAT passed on throwaway corpus: block exit 4, two sessions shown, release-retry succeeds. Recorded by agent:main-orchestrator (self-reported, not owner/runner-attested); note a parity bug was caught and fixed during it. | 01KX7G4GDNY3P0622HBHM4Z91R (manual, agent-recorded) |

## Gaps

- The sole human-mode AC's live dual-session evidence is self-recorded by agent:main-orchestrator rather than owner/runner-attested (attested_count 0), and it surfaced a real parity bug mid-run that was fixed under the same one-shot authorization.
- MCP parity (lore_claim fields, lore_anchor_set 26→27, bootstrap active_sessions) rests on an 8-test attested suite; the tools.ts production file is truncated so the passthrough correctness cannot be inspected directly.

## Recommendations

- Require an independent (owner or CI runner) execution of human-mode UAT scripts like AC-S3-12 before closeout, rather than accepting orchestrator self-recording.
- Add a named regression test pinning the gate.ts pre-flight vs lore-claim anchor-overlap parity that was caught during UAT.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 48985ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:packages/core/tests/file-anchors.test.ts, diff:packages/lore/src/adapters/mcp/CLAUDE.md, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-enforcer.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/session-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/integration/cli/task-workflow.test.ts, diff:packages/lore/tests/integration/cli/verify.test.ts, diff:packages/lore/tests/integration/gate-config-disable.bun.test.ts, diff:packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-claim-anchors.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/ready-route.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/adapters/mcp-session-registry.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-task-workflow.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/adapters/tree-claim-badge.test.ts, diff:packages/lore/tests/unit/service/checkpoint-registry.test.ts, diff:packages/lore/tests/unit/service/claim-anchor-gate.test.ts, diff:packages/lore/tests/unit/service/claim-session-fields.test.ts, diff:packages/lore/tests/unit/service/file-anchors-validation.test.ts, diff:packages/lore/tests/unit/service/session-registry.test.ts, diff:packages/lore/tests/unit/service/task-workflow-service.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.83 | evidence | All 12 ACs pass; 11 script ACs runner-attested, live UAT passed. Implementation in visible diff matches AC statements (normalize/overlap, carry-forward, gate parity, sessions). |
| evidence_integrity | 85 | 0.8 | evidence | 0.85 attested ratio; script ACs double-run in places. Only weak spot: AC-S3-12 manual evidence recorded by the orchestrating agent, not an independent human/runner. |
| scope_fidelity | 90 | 0.78 | evidence | Diff maps cleanly to T1/T2 plan surfaces (core file-anchors, claim schema, gate, CLI verbs, ready/tree, MCP, CLAUDE.md). No unexplained files; worktree marker cleanup only. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-S3-12 | The sole human-mode AC's live dual-session evidence is self-recorded by agent:main-orchestrator rather than owner/runner-attested (attested_count 0), and it surfaced a real parity bug mid-run that was fixed under the same one-shot authorization. |
| outcome | minor | AC-S3-8 | MCP parity (lore_claim fields, lore_anchor_set 26→27, bootstrap active_sessions) rests on an 8-test attested suite; the tools.ts production file is truncated so the passthrough correctness cannot be inspected directly. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require an independent (owner or CI runner) execution of human-mode UAT scripts like AC-S3-12 before closeout, rather than accepting orchestrator self-recording. | Converts the one manual, self-reported AC into trustworthy attested evidence and removes the conflict of the implementer attesting their own live test. |
| plan | Add a named regression test pinning the gate.ts pre-flight vs lore-claim anchor-overlap parity that was caught during UAT. | The drift was live and fixed reactively; an explicit test prevents recurrence of the exact SSOT divergence. |

## Unverifiable Materials

- packages/lore/src/service/{checkpoint-registry,task-workflow-service,session-service,gate-enforcer}.ts, mcp/tools.ts: Listed in truncation manifest as present but omitted from diff; correctness inferred only from attested test passes.
- AC-S3-12 live dual-session run: Human-mode, manual oracle recorded by agent:main-orchestrator; no independent attestation available to verify.

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.85
