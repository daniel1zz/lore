---
id: TASK-195
type: task
role: plan
title: "SPEC-069 adhoc tasks are unclaimable: task-claim gate crashes walking a prd parent"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-26
tags: []
parent: PRD-001
---
A task created via 'lore create task --adhoc' (SPEC-069 planless task, parented directly to the root PRD with extra.adhoc=true) can never be claimed by any actor. Root cause traced into the lore repo: task-workflow-service.ts:1249-1283 — enforceClaimGate's anchor-overlap check unconditionally calls getPlanBundle(task.parent_id) (corpus-service.ts:1805-1822), which hard-requires the parent doc to be type 'plan'. For an adhoc task the parent is the root 'prd', so the gate throws before any claim logic runs. LORE_GATE_BYPASS does not reach this code path, so there is no escape hatch. Recovery is also awkward: 'lore set' cannot re-parent a task, and a draft task can be neither deprecated (status transition disallowed) nor invalidated (validity metadata is knowledge/adr-only) — the only path is 'lore delete --confirm' + recreate under a plan with --plan-id/--phase/--linkage. Suggested fix: enforceClaimGate should skip the plan-bundle anchor-overlap walk (or fall back to a corpus-wide anchor scan) when extra.adhoc === true. Discovered 2026-07-24 in project guyin; two implementer agents were blocked mid-dispatch. Reporter-side knowledge doc: knowledge-lore-cli-defect-spec-069-adhoc-tasks-are-unclaimable.
