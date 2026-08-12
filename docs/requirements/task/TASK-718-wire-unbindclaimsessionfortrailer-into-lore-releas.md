---
id: TASK-718
type: task
role: plan
title: "Wire unbindClaimSessionForTrailer into lore release, the third wiring gap this plan's anchor design forced an implementer to leave open"
status: draft
priority: medium
phase: "remediation"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
Machine-checked 2026-08-13 at merge 05a5f63d: unbindClaimSessionForTrailer appears 4 times in packages/lore/src/adapters/real-git-port.ts and 0 times in packages/lore/src/service/task-workflow-service.ts. The capability is implemented, unit-tested and proven correct against a negative control, and no production path calls it.

Consequence while it stays unwired: writeClaimSessionMarker is a current-state pointer, so after 'lore release' every later commit in that worktree keeps carrying the released session's Lore-Session trailer. Ownership data that outlives its own claim is worse than absent - it names a holder who has let go.

Scope: call the compare-and-delete unbind from TaskWorkflowService.release, and assert the LIVE call site. An AC that only proves the exported function works would certify exactly the state we are in now.

Note for whoever picks this up - this is the THIRD wiring gap on this plan produced by the same cause, and the cause is the anchor design, not the implementers:
  1. AC-OWN-5 needed pid/start-time on TaskClaim, whose files were anchored to a different task, so a parallel tmpdir heartbeat was built instead.
  2. The stale replay test title recording a gap was outside the anchors of the task that closed the gap.
  3. This one: the unbind's only production call site lives in a file anchored to no task in the remediation phase.
In all three the implementer flagged the gap honestly rather than expanding scope silently, which is the correct behaviour. A spec's file anchors MUST cover the production call site as well as the capability, or the two land in different acceptance units by construction.
