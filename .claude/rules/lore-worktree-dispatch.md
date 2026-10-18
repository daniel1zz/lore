<!-- lore:managed fragment=worktree-dispatch hash=1966d9e6 -->
## Worktree dispatch

- Actor discipline: identity is per run (`lore run show <id>`); the implementer claims inside its own worktree, the main agent never claims on its behalf; claim conflicts are judged per run (BR-1040), not by name.
- Merge each returned branch at once with `git merge <branch> --no-ff`, task slug in the merge message. Run `lore done` BEFORE `git branch -d`. After the merge is confirmed (`git branch --merged main`), `lore done` removes the worktree itself (read its `worktree: removed|gone|kept <path>: <reason>` line; on `kept`, follow the reason, never force); run `lore worktree sweep --apply` at each round end; never delete an unmerged worktree.
- After EVERY merge run `git branch -a` and `git log --oneline main..<branch>` per branch, unconditionally: a sub-agent's own sub-agent can open a branch the parent's reply never names.
- Failures: retry at most twice via SendMessage with the failure text; then discard the worktree and redo with a fresh agent given the failure summary as an anti-pattern.
- The subagent records `lore evidence` and `lore release` and stops; after the merge verifies, the main agent runs `lore done <task>` (else the task stays in the ready set) and, for script-bound ACs, `lore verify <plan>`. At phase end `git diff` in full and read `lore ready --json` through `counts.ready` (`.records` also holds archived rows); plan done means `lore assess`.
- Scoped-oracle floor: every file importing the changed module, not just the task's anchors.
- Post-merge static floor: run `bun run check:static` (build, typecheck and every `check:*` script, one exit per step, non-zero if any failed); `build` and `typecheck` alone miss red `check:*` steps. The `check:spec-mirror` and `check:live-repo-state` rows are corpus-dependent: they need a fresh mirror export.
- Verify after a merge with the build cache bypassed (`--force`): shared turbo/nx caches replay the agent's own result.
