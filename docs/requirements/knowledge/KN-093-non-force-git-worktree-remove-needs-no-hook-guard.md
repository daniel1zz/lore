---
id: KN-093
type: knowledge
role: knowledge
title: "Non-force git worktree remove needs no hook guard — git is already the gate"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: KN-092, type: relates-to}
  - {id: KN-089, type: relates-to}
---
# Non-force `git worktree remove` needs no hook guard — git is already the gate

## Status

Supersedes the P0 recommendation carried in two prior docs:

- `knowledge-session-process-review-2026-07-20-lore-self-audit-fix` (I5 merge-verify finding)
- `knowledge-session-process-review-2026-07-21-setup-scaffold-confi` + `knowledge-handoff-agent-main-orchestrator-11`, which escalated it to P0 ("do this FIRST — a twice-recommended, un-built gate is itself a governance failure")

The recommendation was: extend `pre-bash-git-safety-gate.mjs` with a rule on the NON-force `git worktree remove` path, blocking when the worktree's branch has `git rev-list --count main..<branch> == 0` and is unmerged.

**The premise is false.** Measured, not reasoned.

## Evidence (empirical probe, throwaway repo, 2026-07-21)

Three cases against a real `git init` repo with real worktrees:

| Case | Worktree state | `git worktree remove <path>` (no `--force`) | Outcome |
|---|---|---|---|
| 1 | tracked file modified, uncommitted | **exit 128** — refused | git blocks it |
| 2 | untracked new file only | **exit 128** — refused, worktree dir still present | git blocks it |
| 3 | clean tree, branch has 1 unmerged commit | exit 0 — succeeded | branch survives; `git rev-list --count main..br3` = 1; `git show br3:feature.ts` reads the content back |

Case 2 is the load-bearing one: git refuses even for untracked-only content, which is exactly the shape an implementer's un-`git add`ed work takes. Case 3 proves that when removal DOES succeed, `git worktree remove` never deletes the branch — every commit stays reachable.

## Why the guard would be net-negative

1. **No data-loss vector to close.** Cases 1+2 are already hard-blocked by git itself, and git's check inspects the real worktree, not a path argument parsed out of a command string — strictly more reliable than a hook heuristic.
2. **Case 3 loses nothing.** The branch and its commits persist; recovery is `git checkout <branch>`.
3. **The rest of the chain is already covered.** `git branch -d` refuses an unmerged branch; `git branch -D` and `git worktree remove --force` are both already blocked by existing rules in the gate.
4. **A `0 commits ahead` block would hit the documented happy path universally.** After a successful `git merge <branch> --no-ff`, the branch IS an ancestor of main, so `main..branch` is 0 — indistinguishable from "the agent produced nothing" without fragile reflog archaeology. The CLAUDE.md-documented cleanup (`git branch --merged main` → `git worktree remove <path>` → `git branch -d`) would be blocked on every single worktree.

## What the finding was actually reaching for

The W4 incident's real defect was the PRODUCER side — an implementer ending its turn with work existing only as uncommitted worktree files. That half shipped 2026-07-21 as `subagent-stop-commit-guard.mjs` (blocks on uncommitted changes / 0 commits ahead / deferral-shaped final message). The consumer-side "twin" the retro imagined does not exist as a real hole, because git occupies that slot already.

The residual orchestrator discipline — treating a merge that prints "Already up to date" on a branch that SHOULD carry work as a STOP signal — remains prompt-level, and correctly so: it is a judgment about *expected* work, which no repo-state probe can determine.

## Lesson

A twice-recommended mechanization is a strong signal to build, but not a substitute for checking whether the underlying tool already enforces the invariant. Both prior retros reasoned about `git worktree remove` semantics from memory and neither ran the three-case probe; the escalation rule ("un-built repeat = governance failure") amplified an unverified premise instead of surfacing it. Escalation should trigger a verification pass first, not a build pass.
