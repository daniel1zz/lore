---
id: TASK-715
type: task
role: plan
title: "AC-OWN-5's oracle exercises only the pure verdict function, and the replay test's title still denies a fact it now asserts"
status: draft
priority: medium
phase: "remediation"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
Two truth defects found by assess and machine-checked 2026-08-13.

1. STALE TITLE (assess called this a blocker; it is half right). territory-replay.bun.test.ts:236 still reads 'reconstruct 3 of the 4 facts exactly, non-empty; the 4th (a per-branch commit COUNT) has no lore surface - a P1 finding, not papered over'. That sentence became FALSE the moment countUnmergedCommits landed. assess concluded from it that the count fact is unasserted; that conclusion is WRONG - line 360 asserts expect(commitCountByBranch).toEqual({ 'foreign-branch': groundTruthUnmergedCount }), an exact comparison against ground truth. The assertion is sound and the title lies about it. The comment at :352 ('commitCountByBranch IS that empty set') is stale for the same reason.

Root cause is an anchor-design defect, not implementer failure: the count task's anchors covered the port, the partitioner and the command, but NOT the test file recording the gap - so the agent that closed the gap had no permission to update the sentence describing it. Rewrite both to be mechanically checkable (name the file:line and the fact asserted), never 'fixed'.

2. COMMAND-LEVEL ORACLE. AC-OWN-5 names 'lore session list' but every test title under it reads 'deriveLivenessVerdict (pure)'. The pure decision function is proven; the shipped command surface is not. Add an oracle that runs 'lore session list --json' and asserts the liveness field on its output, alongside the existing unit tests.

Also disclose, at the surface rather than only in JSDoc, that liveness is measurable ONLY for a session that has itself run the command at least once (tmpdir heartbeat self-registration) - a peer that never ran it reports 'unmeasured', and a reader must be able to tell that apart from 'measured and unknown'.
