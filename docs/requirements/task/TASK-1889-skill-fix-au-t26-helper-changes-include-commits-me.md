---
id: TASK-1889
type: task
role: plan
title: "[Skill:fix] AU-T26 helper changes include commits merged in from main (base..HEAD), so a helper that merged main is charged with another session's files"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: Turn-end review 2026-10-19 charged INT-T9's implementer (a21642f8ea6426b6a, task anchors scripts/run-chain.ts, package.json, its test) with ~500 files "outside the anchors" — every file another session's ES-B changed. The implementer had merged main into its branch (8d17d8d7) as instructed; the helper's measured changes are `<base>..HEAD` of its working copy, so commits that arrived by merging main count as the helper's own. A helper's changes are what ITS commits (and its uncommitted edits) changed: exclude anything reachable from main at measurement time (e.g. diff against merge-base(HEAD, main) after the merge, or only first-parent non-merge commits authored in the run window) — pick the rule that also holds when the helper merges main more than once; no file allowlist.
Red-first: fixture worktree whose branch commits file A, then merges a main that changed B -> today B is charged to the helper (red); after: only A.
Source: turn-end review 2026-10-19
AC: test green; AC-ST-8 oracle and helper-scope tests pass.
