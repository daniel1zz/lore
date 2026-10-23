---
id: TASK-1859
type: task
role: plan
title: "[Skill:fix] Turn-end helper review handles a helper whose working copy was already removed after landing"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (observed 2026-10-19 right after `lore worktree sweep --apply` removed landed worktrees): the turn-end helper review runs the gitignore probe with the helper's working copy as cwd; for a working copy that no longer exists the spawn fails and the review prints "ignore status not measured ... (git check-ignore exited undefined)" for every edited path of three helpers, and then reports helper ab8f32c1602ebdaf3's `.scratch/patch.py` (gitignored) as "changed files outside the anchors". Removal is the normal end of a landed helper, so every round end produces this noise; "exited undefined" also hides the real cause (cwd missing).
Approach: decide what a removed working copy means for the review before probing: if the working copy is gone AND its helper's branch/commits are merged into main (the landing is what removed it), the review evaluates ignore status against the repository's ignore rules at main (`git -C <repo root> check-ignore --no-index` on the repo-relative paths) and says so; if the working copy is gone and the landing cannot be shown, report one not-measured line per helper naming the cause "working copy removed", not per path, and never "exited undefined". The probe's error message carries the spawn error (ENOENT cwd), never `undefined`.
AC: unit tests with a throwaway repo: (1) removed working copy whose branch is merged: an ignored `.scratch/x` edit is not a finding and a tracked out-of-anchor edit still is; (2) removed, unmerged: one not-measured line naming "working copy removed"; (3) a spawn error's message appears verbatim, never "undefined". Make (1) red once.
