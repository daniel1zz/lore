---
id: TASK-1706
type: task
role: plan
title: "A corpus-only task with a captured pass can never be archived: evidence demands a worktree claim, done then demands a landing"
status: deprecated
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19 (session 482f1e89) on task-retire-superseded-integrate-criteria-apply-the-main-guard, a corpus-only P2 task (no code, no branch):
1. `lore evidence --result pass` refused: 'its claim recorded NO worktree, but this call is running from inside a git repository … Re-claim with lore claim <task> --worktree "$PWD"'.
2. After re-claiming with --worktree (a detached verification worktree), `lore done --declare-no-new-tests` refused with [floor: not-landed]: 'was claimed on <worktree> and lore done archives only work whose landing lore integrate recorded'.
3. Re-claiming without --worktree does not clear it; creating a branch at main in that worktree and running `lore integrate <branch>` prints 'already integrated … nothing to do' and records no landing (the claim captured no branch while detached).
So a corpus-only task that records a runner-attested pass can never be archived: the evidence floor demands a worktree claim, and the landing floor then demands a code landing that does not exist. Earlier the same day the coverage plan's corpus-only P2 task (claimed without a worktree, evidence via lore verify only) archived fine, so the trap opens only when a pass is recorded with lore evidence.

End state: the landing floor applies to work that changed tracked files; a task whose claim's worktree never diverged from main (or that declares itself corpus-only) is archivable on its evidence alone — one predicate shared by evidence and done.

AC: on a throwaway repo+corpus, a task claimed with --worktree on a detached checkout of main, given a captured pass and no commits, is archived by lore done; a task whose worktree holds an unlanded commit is still refused [floor: not-landed].
