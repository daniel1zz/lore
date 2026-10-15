---
id: SPEC-158
type: spec
role: spec
title: "Lore owns worktree cleanup: archive removes the task's recorded worktree; a sweep catches the rest"
status: deprecated
priority: medium
created: 2026-10-10
updated: 2026-10-12
tags: []
---
# Lore owns worktree cleanup: archive removes the task's recorded worktree; a sweep catches the rest

Issue #106. Rules BR-961, BR-962 (baseline-archive-a-task).

## Problem
Claude Code creates subagent worktrees (`.claude/worktrees/agent-<id>`, branch `worktree-agent-<id>`) and removes one automatically only when it has no changes; its periodic sweep keeps any worktree with unpushed commits. Lore's merge-then-archive flow commits in every worktree and never pushes the branch, so finished worktrees accumulate. Today cleanup is prose in user rules plus a user-level hook (`~/.claude/hooks/pre-bash-git-safety-gate.mjs`) that ships to no consumer; an orchestrator reached for `--force`, was blocked, and handed safe work to the owner.

## Design
- **Source of truth**: only worktrees recorded by a lore claim (`extra.claim.worktree` and the claim audit history, which survives `lore release`). A worktree no claim recorded is never listed or touched.
- **Predicate (all must hold to remove)**: path exists and is a linked worktree of this repo (never the main checkout); no tracked or untracked changes; branch (or detached HEAD) has >= 1 commit not in the base's history at claim time AND every such commit is reachable from the main line (a zero-commit branch is "never started", not "landed"); no reflog activity in the worktree for 30 minutes; not git-locked; owning task archived or deprecated.
- **On `lore done`**: after the archive walk succeeds, evaluate the task's recorded worktree; remove it with plain `git worktree remove` (never `--force`) and `git branch -d` (never `-D`). Archival never fails because of cleanup; the outcome (removed / kept: <reason> / not-measured: <reason>) is printed and stored in the audit row.
- **`lore worktree sweep [--apply] [--json]`**: lists every claim-recorded worktree of archived/deprecated tasks with decision + reason; default reports only; `--apply` removes exactly the "remove" rows.
- No silent fallback: a git call that fails makes the row `not-measured`, never `remove`.
- Concurrency: two sessions sweeping at once — git itself refuses removing an already-removed worktree; the second reports `gone`. The 30-minute quiet window protects a live session.

## Non-goals
Pushing branches; touching worktrees created by `git worktree add` outside claims; changing Claude Code's own sweep.

## Acceptance criteria
See `lore ac list` (AC-WTC-1..3).


## Acceptance Criteria (structured)

- [⚑] [script] AC-WTC-1: In a temp git repo with a temp corpus (describe 'done removes the recorded worktree (#106)'): after lore done on a task whose claim recorded a worktree, a clean worktree whose branch has >=1 own commit in main and no git activity inside the quiet window is removed and its branch deleted, and the output says removed; a zero-commit branch, an uncommitted change, an unmerged commit, recent activity, or a git-locked worktree each keep the worktree, exit 0, and name that reason; a worktree no claim recorded is untouched
  script: test — cd packages/lore && bun test tests/integration/cli/done-worktree-cleanup.bun.test.ts && echo 'AC-WTC-1 PASS: done removes only clean+merged+quiet recorded worktrees; every keep reason named'
- [⚑] [script] AC-WTC-2: lore worktree sweep (describe 'worktree sweep (#106)'): without --apply it lists every claim-recorded worktree of archived/deprecated tasks with remove/keep and a reason, exits 0 and changes nothing (worktree list byte-identical before/after); with --apply it removes exactly the rows listed remove; a worktree no claim recorded is not listed; a failing git probe yields not-measured, never remove
  script: test — cd packages/lore && bun test tests/integration/cli/worktree-sweep.bun.test.ts && echo 'AC-WTC-2 PASS: sweep reports by default, --apply removes exactly the remove rows, unrecorded untouched, git failure not-measured'
- [⚑] [script] AC-WTC-3: After the change, lore baseline coverage on the branch holding baseline-archive-a-task exits 0: every new census site of done and worktree sweep is mapped to BR-961, BR-962 or a non-business reason
  script: other — bun run packages/lore/src/index.ts baseline coverage baseline-execution && echo 'AC-WTC-3 PASS: execution branch 0 coverage gaps after worktree cleanup'

## Code anchors

- packages/lore/src/service/worktree-cleanup.ts
- packages/lore/src/adapters/cli/commands/worktree.ts
- packages/lore/src/service/task-workflow-service.ts
