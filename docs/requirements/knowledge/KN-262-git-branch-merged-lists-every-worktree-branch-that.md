---
id: KN-262
type: knowledge
role: knowledge
title: "git branch --merged lists every worktree branch that has not started work yet — cleaning by that list deletes live agents workspaces"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
MEASURED 2026-08-01, mid-session, with five dispatched worktree agents of which exactly ONE had finished:

    $ git branch --merged main | grep worktree
    + worktree-agent-a05cb9ef1c607a77a
    + worktree-agent-a228a0ef91369e441
    + worktree-agent-a37628a51dd94151f
    + worktree-agent-a67ec57185bd674d8
    + worktree-agent-afcb0815126731414      <- the only one actually merged

All five are reported as merged. The four false entries were branches still sitting at the
dispatch base commit e1bd0b1 with ZERO commits: an ancestor of main is trivially "merged", so
a branch that has produced nothing is indistinguishable from one whose work has landed.

## Why this is dangerous specifically here

The project cleanup rule is: after confirming a merge with `git branch --merged main`, run
`git worktree remove` + `git branch -d`. Applied to that output mid-flight, it removes the
working directories of four agents that are actively editing files in them. The agents do not
fail loudly -- they are mid-task with open file handles; the destruction surfaces later as
missing work.

The inverse error is already catalogued ("Already up to date" on a branch that SHOULD carry
work = STOP). This is the same coin: `--merged` conflates "landed" with "never started", and
the existing lesson only warns about the merge side, not the CLEANUP side.

## Correct predicate

`--merged` answers "is this branch an ancestor of main", which is not the question. The
question is "did this branch produce commits, and are they in main". Gate cleanup on:

    git log --oneline main..<branch>     # empty AND agent reported done -> suspicious, investigate
                                         # empty AND agent still running  -> DO NOT TOUCH
                                         # non-empty                      -> merge, then clean

i.e. never clean a worktree whose agent has not returned a completion report, regardless of
what `--merged` says. Liveness is tracked by the dispatcher, not by git.

## Also observed in the same listing

`git worktree list` showed a worktree belonging to a DIFFERENT concurrent session
(a detached-HEAD fullsuite-wt under another session id). Worktree cleanup driven by a
repo-wide listing can therefore reach outside the current session entirely. Only ever remove
paths this session created and whose agent has reported completion.
