---
id: TASK-1744
type: task
role: plan
title: "Turn-end helper review never converges: a timed-out review marks nothing, so the unjudged set only grows"
status: draft
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Measured 2026-10-19, session c1ffea04 (one long orchestrator session, several compactions): the trail holds 2342 helpers, 1046 judged, 1296 unjudged. Running the hook's exact spawn by hand (lore --harness-run cc:<session> session trail-review --json) took 117 s and returned 24 findings and 409 not-measured lines; the hook's budget is TRAIL_REVIEW_TIMEOUT_MS = 15000 (assets/hooks/lib/session-trail.mjs:939, commented as only bounding a hang). Every one of those helpers belongs to this session; none are from earlier sessions.

Why it is slow (packages/lore/src/service/helper-scope-review.ts reviewHelperScope): for each unjudged helper it (1) computes groupKey for every helper in the trail (realpath per helper): O(N^2); (2) scans every edit record of every turn: O(N x edits); (3) scans every helper again for copy-mates; (4) spawns one git check-ignore and runs one openClaimsOfWorkingCopy query.

Why it never converges (assets/hooks/stop-turn-review.mjs step 4b, AC-ST-9/10): only a successful spawn marks the snapshot judged; a timed-out spawn marks nothing, so the next turn submits a larger set and times out again. The 1046 judged markers date from when the set was still small. Since then, helper work has gone unreviewed every turn behind one not-measured line.

End state to design (raising the timeout is not a fix: the hook blocks turn end):
- Review cost is proportional to the turn: a bounded batch per spawn, oldest first, each batch marked judged when it completes.
- The working-copy grouping is computed once per review, not once per helper.
- Edit records are indexed by run.

Oracle: a fixture trail with N helpers above one batch converges to zero unjudged within ceil(N/batch) turns, each spawn under the budget.
