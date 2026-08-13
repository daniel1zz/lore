---
id: TASK-718
type: task
role: plan
title: "Wire unbindClaimSessionForTrailer into lore release, the third wiring gap this plan's anchor design forced an implementer to leave open"
status: archived
priority: medium
phase: "remediation"
created: 2026-08-12
updated: 2026-08-13
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

## AC-OWN-4 re-baseline, 2026-08-13 by agent:main-orchestrator (recorded BEFORE dispatch)

This task's governing criterion was tightened before any work started. An oracle
edit that follows a GREEN pass is audit-indistinguishable from a weakening, so
the three facts the discipline requires are recorded here rather than inferred
later:

1. ORIGINAL (oracle_generation 2, attested PASS on 2026-08-12):
   statement — "a commit created under a claim carries the Lore-Session git
   trailer, readable via git log --format=%(trailers:key=Lore-Session,valueonly)"
   command — bun test packages/lore/tests/unit/adapters/cli/lore-session-trailer.bun.test.ts 2>&1
             && echo 'AC-OWN-4 PASS: commits under a claim carry the Lore-Session trailer'

2. WHAT IT PRODUCED: no failure. It passed, attested, and stayed passing while
   `unbindClaimSessionForTrailer` had zero production call sites. That is the
   defect: the statement asserted only the bind direction, so the release half of
   the trailer lifecycle could be entirely absent without reddening it. The
   generation-2 pass is not retracted — it was true about what it asserted.

3. WHY THIS IS A TIGHTENING, NOT A WEAKENING: the new statement adds a second
   obligation (a commit after `lore release` carries NO trailer) and constrains
   HOW both are proven (through TaskWorkflowService call sites, not the
   real-git-port exports). Nothing was removed; the command still runs the same
   file, and the file's existing bind-side cases remain in scope. The strictly
   larger obligation set is why oracle_generation moved 2 -> 3, marking every
   generation-2 evidence row as prior-generation.

Authority for the change: this plan's own Phase `binding` text — "the capability
and its production wiring are the same acceptance unit ... and the ACs assert the
live call sites" — which AC-OWN-4 at generation 2 did not honour.

## Anchor widened in the same pre-dispatch pass

file_anchors went from 1 file to 3. The two additions are not incidental:

- `packages/lore/src/adapters/real-git-port.ts` — its `unbindClaimSessionForTrailer`
  JSDoc (~line 472) states "⛔ Not yet wired into TaskWorkflowService.release".
  Wiring it turns that sentence into a false statement in the same commit, so the
  fix and the comment recording the gap must be one acceptance unit.
- `packages/lore/tests/unit/adapters/cli/lore-session-trailer.bun.test.ts` — the
  same "⛔ NOT YET wired" claim appears in its module header (~line 64), AND this
  file is AC-OWN-4's declared oracle, so the live-call-site assertion has to land
  here.

Leaving the anchor at one file would have reproduced this plan's own four-times
-measured failure mode a fifth time: capability and call site in different
acceptance units. Both replacement comments MUST be grep-checkable (name the
symbol and the call site), never "already fixed".
