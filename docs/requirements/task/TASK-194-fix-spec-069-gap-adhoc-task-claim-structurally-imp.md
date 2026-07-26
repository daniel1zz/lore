---
id: TASK-194
type: task
role: plan
title: "Fix SPEC-069 gap: adhoc task claim structurally impossible (claim gate PRD-parent vs getPlanBundle)"
status: archived
priority: high
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PRD-001
---
Discovered 2026-07-24 during SPEC-075 closure — FIRST adhoc claim ever attempted in this corpus. lore claim on an adhoc task fails exit 4: 'Expected a plan document; got type prd'. Root cause (source-verified, not guessed): TaskWorkflowService.enforceClaimGate (task-workflow-service.ts ~1269-1276) and gate.ts::runTaskClaimGate (~742-763) vacuous-pass ONLY on task.parent_id === null, but SPEC-069 adhoc tasks are auto-parented to the root PRD (parent_id non-null) -> else-branch calls getPlanBundle(prd_id) which requires plan.type === 'plan' (corpus-service.ts ~1815-1822) and hard-fails. Fix direction: treat 'resolved parent exists but is not type plan' (or extra.adhoc === true) the same as parent_id === null — vacuous pass; add a .bun/vitest regression test claiming an adhoc task end-to-end. AC: (1) lore claim <adhoc-task> --by x --worktree y exits 0 on a seeded adhoc task; (2) existing task-claim gate tests stay green; (3) anchor-overlap gate still fires for adhoc tasks with declared anchors.
