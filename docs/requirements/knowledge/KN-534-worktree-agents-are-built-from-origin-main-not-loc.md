---
id: KN-534
type: knowledge
role: knowledge
title: "Worktree agents are built from origin/main, not local HEAD, so the standing pull-before-dispatch rule is a no-op exactly when it matters"
status: approved
priority: critical
created: 2026-08-24
updated: 2026-08-24
tags: [worktree, dispatch, concurrency, stale-baseline, false-precondition, retro]
parent: PRD-001
---
# Worktree agents are built from `origin/main`, not local HEAD — so the standing "pull before dispatch" rule is a no-op exactly when it matters

Measured 2026-08-24 in this repo, from a stalled subagent whose confusion had an external cause.

## The standing rule, and why it does not protect anything

The dispatch discipline reads: *"dispatch 前必须 `git pull --rebase origin main`（harness 基于当前 HEAD 建 worktree，不自动 pull）"* — i.e. pull first, because the harness builds the worktree from **current HEAD**.

The parenthetical is FALSE, and the rule built on it fails in the one configuration where a stale baseline is possible at all.

**Two independent samples, both from `origin/main`:**

| worktree | dispatched by | its base commit | local HEAD at dispatch |
|---|---|---|---|
| `agent-a3f9b69297e2c4213` (mine, no commits yet, so HEAD == base) | this session | `15f376a4` | `ccb6ac33` |
| `agent-a6aace58b34574206` (another session; its commit `a199d386` has parent `15f376a4`) | a concurrent session | `15f376a4` | `a199d386`-era local main |

`15f376a4` IS `origin/main`. `git merge-base --is-ancestor origin/main main` → true: local main is **56 commits ahead**, pure fast-forward, no divergence.

⛔ So `git pull --rebase origin main` before dispatch is a **guaranteed no-op** here — there is nothing upstream to pull. It reports success, changes nothing, and the worktree is still built 56 commits in the past. The rule's precondition is satisfiable while the hazard it names is fully present. Running it and seeing "Already up to date" reads as clearance.

## What it cost, measured

My tester agent was handed a baseline I measured on local `main`. Its worktree had `origin/main`. The three files under test differ across that gap by **874 insertions / 705 deletions**:

```
packages/lore/src/adapters/cli/commands/issues.ts        | 537 +++++++++---
packages/lore/src/adapters/cli/commands/report-issue.ts  | 346 ++++-----
packages/lore/src/adapters/cli/report-issue-wiring.ts    | 696 +++++--------
```

Three commits in the gap rewrote exactly the subject under test: `8b3845b1` (deleted the SQLite transport modules, retired `corpus_path`/`transport`), `41e552d9` (implemented `GitHubIntakePort`, rewired the live filing path), `5edf92f7` (implemented `lore issues --verify`).

The agent probed the GitHub-shape behaviour, got results that contradicted the handed-down baseline, started writing a scratch `debug-github-shape.ts` to reconcile them, and stalled (600s, watchdog did not recover). ⛔ Its failure mode was NOT a logic error and no amount of retrying it would have helped — the discrepancy it was chasing was real and unresolvable from inside its own worktree.

## The wider exposure this uncovered, NOT yet dispositioned

The concurrent session's agent `a6aace58b34574206` did its work (`repoint 8 stale claude-md-check.ts references`) on the SAME stale base `15f376a4`, and that work is ALREADY MERGED into local main as `5b04353f`. So this is not one session's accident: while local main sits ahead of `origin/main`, EVERY worktree agent works 56 commits in the past and its output is merged forward onto a tree it never saw. Whether that specific merge introduced a regression is UNVERIFIED — flagged here, not investigated.

## The mechanism the rule actually needs

⛔ Pulling is the wrong verb. The invariant a dispatcher needs is *"`origin/main` is not behind local `main`"*, and when local is ahead the only thing that establishes it is a **push** — an outward action needing its own authorization, which is precisely why it cannot be buried inside a pre-dispatch reflex.

Two checks, either of which would have caught this, neither of which existed:

1. **Before dispatch**: assert `git rev-list --count origin/main..main` is `0`. A nonzero count means every worktree built now is stale by that many commits. ⛔ Note `git rev-list --left-right --count main...origin/main` returning `56 0` is what I actually ran, and I read it as "nothing to pull, precondition met" — the number that mattered was the LEFT one, and the rule's wording pointed me at the right one.
2. **After the worktree exists, before trusting any measurement from it**: `git -C <worktree> log --oneline -1` and diff its base against the baseline the bundle handed the agent, scoped to the files under test. This is the only check that survives being wrong about how the harness picks a base.

## The generalisable lesson

⛔ **A precondition stated as a COMMAND ("run `git pull --rebase`") instead of as an ASSERTION ("`origin/main..main` is empty") cannot fail loudly.** The command succeeded, printed nothing alarming, and left the hazard in place. An assertion over the state would have exited nonzero. This is the dispatch-layer instance of the rule already recorded for oracles: an oracle that cannot be made red has no discriminating power — and a precondition that cannot be violated while its hazard is present is not a precondition, it is a ritual.

Second lesson, cheaper: ⛔ **when a subagent's findings contradict the baseline you handed it, suspect the baseline's REACHABILITY before suspecting the agent.** I initially read the stall as an agent-quality problem. The bundle was fine; the ground under it was not.
