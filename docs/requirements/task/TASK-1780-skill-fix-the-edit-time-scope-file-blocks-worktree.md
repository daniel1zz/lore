---
id: TASK-1780
type: task
role: plan
title: "[Skill:fix] The edit-time scope file blocks worktree cleanup and escalates a decision on every finished task"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (observed 2026-10-19 on 5 `lore done` runs right after the edit-time anchor gate landed): every landed worktree was KEPT with "ignored data outside the regenerable set: .lore-scope.json (escalate, decision record 270..274)". The scope file the edit-time gate writes (`<worktree>/.lore-scope.json`, refreshed on claim/anchor/release) survives `lore release`, so worktree cleanup treats it as unknown ignored data and escalates a decision to the human for every finished task — a human-attention leak on the most common path.
Approach: the scope file is lore's own derived state: `lore release` (and the run-end auto-release) deletes it when the worktree holds no open claim, and worktree cleanup recognises a scope file whose claims are all closed as lore-derived and removes it with the worktree (not a governed regenerable-pattern loosening). Then resolve decision records 270-274 as moot once their worktrees are removed.
AC: throwaway repo + linked worktree: claim (scope file written), release → file gone; a scope file left by a crashed run whose claims are all closed does not block `lore done`'s worktree removal (outcome `removed`), and no decision record is created. Runner-produced red.
