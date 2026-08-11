---
id: KN-254
type: knowledge
role: knowledge
title: "A shared checkout makes a full-suite verdict unmeasurable: start-clean is not throughout-clean"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: PLAN-086, type: informs}
---
# A shared checkout makes a full-suite verdict unmeasurable: start-clean is not throughout-clean

## The measurement

Same repo, same machine, same afternoon, `bun run test:bun` three times:

| environment | commit | Ran | fail |
|---|---|---|---|
| isolated worktree | 97c462e (pre-change) | 1662 | 0 |
| isolated worktree | d6a9346 (post-change) | 1662 | 0 |
| the shared main checkout | post-change | **1640** | **5** |

The isolated pre-change and post-change runs are identical to the test, so the change under review caused none of it. The five failures on the shared checkout were: two assets-manifest `tree_digest` mismatches (`AC-RC-8`, `AC-076-10`) and three `stale-binary guard: dist/lore is stale (source changed since last build)` aborts.

## The mechanism

`packages/lore/src/generated/assets-manifest.ts` is a **git-tracked build product**: `bun run build` regenerates it. Several stale-binary guards compare `dist/lore`'s mtime against the newest `.ts` mtime under the source tree.

Within one session the ordering is sound — build writes the manifest, then compiles, so `dist/lore` ends up newest (verified directly: immediately after `bun run build`, zero `.ts` files were newer than `dist/lore`). The failure needs a second writer: a concurrent session running `bun run build` on the SAME checkout pushes that `.ts` mtime past the first session's `dist/lore`, and every guard that fires afterwards reports a stale binary that is not actually stale. Those guards throw in file setup, so the whole file is skipped — which is where the missing 22 tests went, and why a digest recomputed mid-run no longer matches the embedded one.

Concurrency was not hypothetical: during the 437-second run, `HEAD` advanced by a commit authored by another session, `git worktree list` showed a worktree belonging to a different session id (its directory named `fullsuite-wt`), and three `.claude/worktrees/` entries were `locked` with recent HEADs.

## What this refines in the existing lesson

CLAUDE.md already says a full-suite verdict requires a clean tree at a named commit, "or run it in an isolated worktree". The gap it does not state: **`git status --porcelain` being empty at the START of the run proves nothing about the run.** A suite that takes 7–8 minutes is a 7–8 minute window in which a co-resident session can commit, rebuild, and rewrite tracked generated files under you. The parenthetical is therefore not an alternative — on a checkout that any other session might touch, the isolated worktree is the ONLY form of the check that means anything.

## A cheap detector to use every time

**Compare the test COUNT across runs, not just the failure count.** `Ran 1640` versus `Ran 1662` was the tell: failures can be argued about, but a suite that ran 22 fewer tests than its own baseline has files dying before their assertions, and a file that dies in setup is indistinguishable from a file that passed if you only read the failure list. Record the expected `Ran N` for the suite and treat any drop as a hard stop.

Corollary for attribution: when a shared-checkout run shows failures, do not reason about whether the change *could* have caused them — that is inference. Re-run the SAME commit in an isolated worktree, plus its parent as a control. Two isolated runs cost twice 8 minutes and replace an argument with a measurement.

## Also worth knowing

`git worktree list` is the fastest way to discover that you are not alone in a checkout: worktree paths carry the owning session's id, so a path whose session id is not yours means a concurrent session, and a `locked` entry with a recent HEAD means an active one. Check it before trusting any whole-repo measurement — and never remove another session's worktree or an unmerged branch on the strength of it looking like debris (one such branch here held only a build byproduct, but that is knowable only after inspecting it).
