---
id: TASK-1796
type: task
role: plan
title: "A second integrate in the same session's integration worktree is refused instead of overwriting the running floor's corpus snapshot"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Incident 2026-10-19 ~09:18 UTC: two `lore integrate ... --session a979eecd-...` runs of the SAME session overlapped (a wait-loop in the caller's shell did not match). Both used the one per-session integration worktree (.claude/worktrees/integrate-<session>). The second run re-took the corpus snapshot (VACUUM INTO <worktree>/.lore/lore.db) while the first run's floor was reading it: the first floor failed in check:ac-oracle-ownership with "Storage failure: disk I/O error", and the second failed at the snapshot itself ("snapshotting ... failed: disk I/O error"). Nothing landed wrongly (CAS protects main), but two floors (~5 min) were wasted and the failures named a storage error, not the cause.

The ADR (adr-main-advances-only-by-lore-integrate-per-session) gives each SESSION its own integration worktree and assumes one integration per session at a time; nothing enforces it ("an agent should remember" = not enforced).

End state: an integrate run holds an exclusive lease on its integration worktree for its whole duration (an OS file lock on a file inside the worktree, so a crashed run releases it automatically — no stale-lock cleanup). A second run for the same worktree is refused at once, before any merge or snapshot, with exit 75 (try again) naming the holder's pid, branch and start time. Different sessions are unaffected (different worktrees).

AC: red-first — start an integrate whose floor sleeps; a second integrate for the same session exits 75 within 2 s naming the first's pid and branch, and the first run lands unaffected; after the first exits (or is killed), a new run proceeds. Falsifier: today both run and the snapshot is overwritten.
