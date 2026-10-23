---
id: TASK-1831
type: task
role: plan
title: "integrate records per-attempt phase durations so the floor cost assumption is checkable"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Finding (2026-10-19): three consecutive `lore integrate` attempts of worktree-agent-a69d03fadb648149b each took ~18 min (snapshot lines at 04:42:24, 05:01:06, 05:19:24 UTC) and all lost the CAS race (exit 75). ADR adr-main-advances-only-by-lore-integrate-per-session sized its design on ~110 s per attempt; at ~1080 s its own loss formula gives P(loss) near 1 for K>=3 sessions. Nothing recorded where the 18 min went: run-chain.ts:133-143 prints a per-step timing table, but integrate captures floor output in memory (integrate.ts:64) and drops it on success, keeping only a 4000-char tail on failure (integrate-service.ts:76,264); the corpus snapshot (VACUUM INTO of a 1.2 GB .lore/lore.db, integrate-service.ts:254) has no timing at all; the loss file .lore/integrate-losses/<branch>.json holds only losses, moved_by, updated_at. Measured context: 8 cores, load 17-26, two check:floor chains and three evidence --capture typecheck chains running at once.

End state: every integrate attempt persists, per attempt, the duration of each phase (merge, corpus snapshot, each floor step from the run-chain table, CAS) and the outcome, in the integrate-losses record (renamed to an attempt record if needed) and on stdout; `lore status` shows, per un-integrated branch, its loss count and the median attempt duration, so the ADR's cost assumption is re-checkable from data, never silent.

AC: an integrate test with an injected floor that sleeps and a CAS that loses once asserts the attempt record holds snapshot, floor-step and CAS durations for both attempts; the falsifier is the current record (losses/moved_by only).
