---
id: TASK-1871
type: task
role: plan
title: "[Skill:debug] lore evidence --capture of bun run typecheck exits 1 where the direct run exits 0"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (reported by the HR-T7 implementer, 2026-10-19, worktree agent-ab8f32c1602ebdaf3 at f42afce0): `lore evidence <task> --oracle tsc --result pass --command "bun run typecheck" --capture` exited 1 twice, while `bun run typecheck` run directly in the same worktree exited 0. `bun run typecheck:lore && bun run typecheck:lore-tests` under --capture passed; the dashboard step (which runs a prebuild: `bunx @tanstack/router-cli generate`) is the suspect. A capture that differs from the direct run makes attested evidence disagree with reality.
Approach: reproduce in a throwaway worktree of main; diff the environment, cwd and stdio the capture runner gives the command against a direct shell run (env vars stripped or added, TTY absence, HOME, PATH, a 'CI'-like flag); find the variable that flips the dashboard prebuild/tsc; fix it at the capture runner if the runner is wrong, or in the script if the script depends on an interactive environment.
AC: a test that runs a command depending on the identified variable through the capture runner and directly, and asserts the same exit code; `lore evidence --capture` of `bun run typecheck` on main exits 0 when the direct run does. Make the test red once.
