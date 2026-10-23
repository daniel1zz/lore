---
id: worktree-dispatch
title: "Worktree dispatch: lore protocol for parallel implementers"
inject: [launch]
---
## Worktree dispatch

- Actor discipline: identity is per run (`lore run show <id>`); the implementer claims inside its own worktree, the main agent never claims on its behalf; claim conflicts are judged per run (BR-1040), not by name.
- Land each returned branch at once with `lore integrate <branch>` run from your session's worktree: the only way main advances (exit 0 landed, 1 floor failed, 4 conflict: merge main into the branch and re-run, 75 lost races: re-run). ⛔ Never `git merge`, run tests or edit files in the shared checkout: it is a read-only view of main. Corpus commands (`lore done`, `verify`, `evidence`, `create`, `ac`) run from the shared checkout. Run `lore done` BEFORE `git branch -d`. After the landing is confirmed (`git branch --merged main`), `lore done` removes the worktree itself (read its `worktree: removed|gone|kept <path>: <reason>` line; on `kept`, follow the reason, never force); run `lore worktree sweep --apply` at each round end; never delete an unmerged worktree.
- After EVERY landing run `lore territory --json` unconditionally and act only on `mine`/`unowned` entries: a sub-agent's own sub-agent can open a branch the parent's reply never names.
- Failures: retry at most twice via SendMessage with the failure text; then discard the worktree and redo with a fresh agent given the failure summary as an anti-pattern.
- The subagent records `lore evidence` and `lore release` and stops; after `lore integrate` lands it, the main agent runs `lore done <task>` (else the task stays in the ready set) and, for script-bound ACs, `lore verify <plan>`. At phase end `git diff` in full and read `lore ready --json` through `counts.ready` (`.records` also holds archived rows); plan done means `lore assess`.
- Scoped-oracle floor: every file importing the changed module, not just the task's anchors. Run specific test files with `bun run test:file <paths> [-t <name>]` only: it routes Bun and Node-project files to their own runner and fails when a path collects nothing.
- Post-merge floor: `lore integrate` runs the configured floor (`workflow.integrate.floor_command` in this project's `.lore/config.yaml` is {{lore:integrate_floor}}) before main moves, and refuses to land the branch when it exits non-zero; `build` and `typecheck` alone miss a red check the floor names.
- The floor runs with the build cache bypassed (`--force`): shared turbo/nx caches replay the agent's own result.
