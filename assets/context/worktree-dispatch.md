---
id: worktree-dispatch
title: "Worktree dispatch: lore protocol for parallel implementers"
inject: [launch]
---
## Worktree dispatch

- Actor discipline: identity is per run (`lore run show <id>`); the implementer claims inside its own worktree, the main agent never claims on its behalf; claim conflicts are judged per run (BR-1040), not by name.
- The orchestrator prints each subagent's prompt with `lore dispatch <task>` (contract, `lore start`, `lore finish`, `lore land`, standing rules); the implementer starts its worktree with `lore start <task>`, proves it with `lore finish`, and lands it with `lore land <task>`, which queues FIFO and takes `lore integrate` as its landing step (exit 0 landed, 1 oracle failed, 4 refused: read the named next command and run `lore land` again, 75 queue timeout). ⛔ Never `git merge`, run tests or edit files in the shared checkout: it is a read-only view of main. Corpus commands (`lore verify`, `evidence`, `create`, `ac`) run from the shared checkout; `lore land` archives and removes the worktree itself; run `lore worktree sweep --apply` at each round end; never delete an unmerged worktree.
- After EVERY landing run `lore territory --json` unconditionally and act only on `mine`/`unowned` entries: a sub-agent's own sub-agent can open a branch the parent's reply never names.
- Failures: retry at most twice via SendMessage with the failure text; then discard the worktree and redo with a fresh agent given the failure summary as an anti-pattern.
- The subagent runs `lore finish` and `lore land` and stops; `lore land` archives the task, and for script-bound ACs the main agent runs `lore verify <plan>`. A plan closes itself when its last task archives. At phase end `git diff` in full and read `lore ready --json` through `counts.ready` (`.records` also holds archived rows); plan done means `lore assess`.
- Scoped-oracle floor: every file importing the changed module, not just the task's anchors. Run specific test files with `bun run test:file <paths> [-t <name>]` only: it routes Bun and Node-project files to their own runner and fails when a path collects nothing.
- Post-merge floor: `lore integrate` runs the configured floor (`workflow.integrate.floor_command` in this project's `.lore/config.yaml` is {{lore:integrate_floor}}) before main moves, and refuses to land the branch when it exits non-zero; `build` and `typecheck` alone miss a red check the floor names.
- The floor runs with the build cache bypassed (`--force`): shared turbo/nx caches replay the agent's own result.
