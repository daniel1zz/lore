---
id: TASK-1809
type: task
role: plan
title: "Done floor accepts an anchored test file the task deleted instead of demanding a run of a file that no longer exists"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Gate conflict found 2026-10-19: a task that DELETES a test file cannot satisfy both gates.
- The turn-end review (stop-turn-review) requires every file a helper changed, deletions included, to be covered by its task's file anchors (finding: "changed files outside the anchors ... status-exempt-surfacing.test.ts", deleted by task-skill-fix-bl-d2-one-time-migration-retires-the-legacy).
- The done floor `unfiltered-test-file` (task-workflow-service.ts findMissingUnfilteredTestFileRuns ~1377) requires, for EVERY anchored test file, an attested unfiltered pass run; it never checks whether the file still exists, so a deleted test file can never be satisfied and `lore done` refuses forever.
The only way through today is to anchor the file for the review and remove the anchor before `lore done` — a workaround that defeats both checks.

End state: an anchored test file that does not exist in the tree the task landed (deleted by the task's own branch, measured with git against main) is reported by the floor as "removed by this task" and needs no run; an anchored test file that never existed (typo / not yet written) still refuses. One predicate decides "deleted by this task" for both the floor and its message.

AC: red-first test — a task anchoring a test file that its claimed branch deleted (file present at the branch's merge-base, absent on main after landing) archives with the removed note; a task anchoring a test file that exists nowhere is still refused naming it. Falsifier: today's refusal for the deleted file.
