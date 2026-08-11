---
id: TASK-428
type: task
role: plan
title: "T1 — self-reported fail/expected-fail must carry a non-empty output_tail, on BOTH the task and phase tiers"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-083
plan: PLAN-083
---
Add a FOURTH self-report-only guard beside the three that already live in
`TaskWorkflowService._addEvidenceImpl` (`task-workflow-service.ts:717-777`): reject a
`result` of `fail` or `expected-fail` whose `output_tail` is absent or whitespace-only.

## Where it must NOT go

NOT in the shared `appendEvidenceEntry` (`:795-916`). That chokepoint also serves
`recordVerifiedEvidence`, and a runner-attested fail can legitimately carry an empty tail:
`verify-executor.ts:150` returns `""` whenever the child wrote nothing to stdout+stderr —
a silent nonzero exit, a `--quiet` tool, or a timeout killed before flush. Binding the
chokepoint aborts `lore verify` at that AC (`verify-runner-service.ts:770`). AC-ETI-5 is
the control that proves you did not do this.

## Both tiers

`PhaseWorkflowService._addEvidenceImpl` (`phase-workflow-service.ts:468`) is a PARALLEL
implementation, and both CLI and MCP fall back to it on a `{field:"type", value:"phase"}`
rejection (`commands/evidence.ts:304`, `mcp/tools.ts:1456`). Fixing only the task tier
leaves the phase channel open. AC-ETI-6 covers this.

## Error shape

Mirror the existing sibling guards: a `VALIDATION_ERROR` with `field: "output_tail"`, and
a message that ends with the repair action, matching the house style of
`MATCHED_COUNT_REPAIR_HINT` (`evidence-precheck.ts:477`). Do not duplicate
`findFilteredPassRefusal`'s wording — that guard owns the pass path (D2) and two guards
sharing phrasing makes their scopes indistinguishable in a transcript.

## Verification discipline

Write each test RED first and RECORD the red run as a `result=expected-fail` evidence row
carrying a NON-EMPTY `output_tail` showing the actual failure text. This slice exists
because that ask was dropped twice in prose; dropping it here would be self-refuting.
