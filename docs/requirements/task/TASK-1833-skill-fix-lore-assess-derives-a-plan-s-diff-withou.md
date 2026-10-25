---
id: TASK-1833
type: task
role: plan
title: "[Skill:fix] lore assess derives a plan's diff without the main commits its task branches merged in"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (measured 2026-10-19, `lore assess plan-human-review-surface-decision-detail-dashboard-needs-you`): "Derived diff from 37 commit(s) across this plan's tasks", 633,772 chars. The diff contains a peer session's ES refactor (packages/core/src/actor-resolution-node.ts, invocation.ts, run-identity.ts, cli-exit.ts, defineLoreCommand across every command) that no HR task touched. Those commits came into the HR task branches through `git merge main` (the documented conflict-resolution step of lore integrate). The judge scored scope_fidelity 55 with a "major" gap blaming the plan for code it did not write. Every plan whose tasks merged main gets the same false finding, and the 80,000-char budget truncates the real changes out.
Approach: derive each task's diff as the change the task's branch introduced relative to the main it merged, i.e. exclude commits reachable from main at the time of landing: for a landed branch use the landing merge's first-parent diff (main before -> main after) or `git diff <merge-base-with-main-at-landing>...<branch-head>` excluding merged-in main commits (`git log --first-parent` / `--no-merges` relative to main). Name the exact rule in the output ("N commits, excluding M merged in from main").
AC: in a throwaway repo, a task branch that merges main (bringing a foreign file change) and adds its own file: the derived diff contains its own file and not the foreign one; output names the excluded count. Make it red once.
