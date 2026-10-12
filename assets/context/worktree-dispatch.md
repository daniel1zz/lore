---
id: worktree-dispatch
title: "Worktree dispatch: lore protocol for parallel implementers"
audience: [main]
mode: static
---
## Worktree dispatch

- Before each dispatch re-check that the upstream governance docs are claimable: a sibling task's wrap-up can block a later claim that the implementer cannot self-resolve. Re-check one by one, never from the batch-start snapshot.
- File mutex: tasks declare `--anchor` file anchors and a concurrent claim with an intersecting anchor is denied (`gate:task-claim:anchor-overlap`). Read `lore ready <plan> --json` (sessions / anchor_conflicts) first; manual queueing is defense in depth for anchors never declared.
- Actor discipline: identity is per run (`lore run show <id>`); the implementer claims inside its own worktree, the main agent never claims on its behalf; claim conflicts are judged per run (BR-1040), not by name.
- Merge each returned branch at once with `git merge <branch> --no-ff`; put the task slug in the merge message (`lore assess`'s fallback). Run `lore done` BEFORE `git branch -d`: done records the task's commit range from the claim's branch tip, which assess uses first. After the merge is confirmed (`git branch --merged main`), `git worktree remove <path>` and `git branch -d <branch>`; never delete an unmerged worktree.
- After EVERY merge run `git branch -a` and `git log --oneline main..<branch>` per branch, unconditionally: a sub-agent's own sub-agent opens a branch the parent's reply never names (726 lines of tests once sat on an orphan branch).
- Failures: retry at most twice via SendMessage with the failure text; then discard the worktree and redo with a fresh agent, the failure summary injected as an anti-pattern.
- Acceptance split: the subagent records `lore evidence` and `lore release` and stops; after the merge verifies, the main agent runs `lore done <task>` (else the task stays in the ready set) and, for script-bound ACs, `lore verify <plan>`. At phase end `git diff` in full and `lore ready --json` read through `counts.ready` (`.records` also holds archived rows); plan done means `lore assess`.
- Scoped-oracle floor: every file importing the changed module, not just the task's anchors.
- Verify after a merge with the build cache bypassed (`--force`): turbo/nx caches are shared across worktrees, so a rerun printing `Cached: N cached` replays the agent's own result.
