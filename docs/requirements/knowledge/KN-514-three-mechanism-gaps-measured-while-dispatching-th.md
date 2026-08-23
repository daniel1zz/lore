---
id: KN-514
type: knowledge
role: knowledge
title: "Three mechanism gaps measured while dispatching the GitHub-intake plan: red-first tasks are un-archivable, falsifier declaration demotes a spec, and --merged is unsafe for worktree cleanup"
status: approved
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [gates, red-first, falsifier, worktree, dispatch]
parent: PRD-001
---
# Three mechanism gaps measured while dispatching the GitHub-intake plan

Measured 2026-08-23 while executing `plan-land-the-github-intake-defect-channel-runner-cap-removal`. Each is a mechanism defect with a named fix, not an execution complaint.

## 1. Red-first test tasks are structurally un-archivable, and that deadlocks the impl task they block

Three gates stack on `lore done`, and their conjunction is unsatisfiable for a red-first task:

1. **attestation floor** — requires ≥1 evidence row that is BOTH `result:"pass"` AND carries `attestation`. `expected-fail` never counts.
2. **red_first gate** — requires an `expected-fail`/`fail` row (or an `extra.red_first` opt-in, or the `--declare-no-new-tests` escape).
3. **test-anchor floor** — for EACH declared test-file anchor, requires an `oracle:test result:pass` row whose command runs that file unfiltered.

A red-first task's success condition IS a red run. Gate 3 therefore can never be satisfied while the paired implementation is absent — which is precisely when the task is complete. `--override-attestation` clears gate 1 only; gate 3 still refuses.

**Why it deadlocks rather than merely annoys**: the plan skill's TDD injection wires `test blocks impl`, and readiness requires every blocker ARCHIVED. So: test task cannot archive until impl exists → impl task cannot become ready until test task archives. Measured on this plan with 5 such pairs.

**Workaround applied**: removed the five `test → impl` blocks edges with `lore unlink`, moving the TDD ordering guarantee from the edge into the impl task's own AC ("the paired RED test file must go green"). That is arguably STRONGER — an edge only orders the work, the AC constrains the result — but it is prose-to-mechanism conversion done by hand, per plan, and nothing enforces that a future planner does the same.

**Mechanism fix (needed)**: a first-class task shape for red-first work. Either (a) `extra.red_first: true` should exempt the task from gates 1 and 3 while REQUIRING an `expected-fail` row, or (b) the plan skill should stop emitting `test blocks impl` edges and instead emit the AC clause. (a) is better: it keeps the edge's ordering guarantee and makes the exemption legible in the corpus rather than living in a planner's habit.

## 2. Declaring a falsifier demotes an approved spec, and a concurrent dispatch batch dies on it

`lore ac set <spec> <id> --falsifier-path/--falsifier-find/--falsifier-replace/--falsifier-exit-code` re-runs AC validation and demotes the spec `approved → draft` — same as editing a `statement`.

Measured cost: four `lore-implementer` agents dispatched against a spec verified `approved (v31)` were ALL hard-denied at `lore claim` with `UPSTREAM_NOT_APPROVED`, because a falsifier declaration between bundle-authoring and claim had moved the spec to `draft (v32)`. Roughly 310k subagent tokens produced zero code. Every one of the four behaved correctly: stopped at the gate, touched no file, reported BLOCKED, attempted no bypass.

**Why the existing standing lesson did not prevent it**: CLAUDE.md already says "凡本轮动过 AC，同一 session 内 MUST review + approve 复位". A falsifier is METADATA about how to falsify a criterion — it changes no assertion, no command, no statement. Nothing in the flag's name or help suggests it is an AC edit in the demoting sense. The lesson is about editing criteria; this reads as annotating one.

**Mechanism fix (needed)**: either (a) falsifier declaration should not demote (it cannot change what the AC asserts), or (b) `lore ac set --falsifier-*` should print the demotion in its own output — it currently prints the AC list and says nothing about the status change. (a) is preferable; (b) is the minimum.

## 3. `git branch --merged` is not a safe predicate for worktree cleanup

A freshly created worktree branch with zero commits is an ANCESTOR of main, so `git branch --merged main` lists it alongside genuinely-merged branches. Cleaning up by that predicate deletes the worktrees of agents currently working.

Measured: `--merged main` returned 14 branches while 5 agents were mid-flight; 4 of the 14 were their live worktrees, and 3 more were a concurrent session's.

The repo's own `pre-bash-git-safety-gate` hook already refuses `git worktree remove` unless the worktree is CLEAN **and** MERGED **and** QUIET for 30 minutes — that third conjunct is exactly what `--merged` lacks. The gate held; the lesson is that the predicate a human/agent reaches for first is unsafe on its own.

**Safe predicate**: `git log main..<branch>` empty AND the agent has reported AND `git reflog show <branch> --date=iso` quiet. Merged-ness alone is insufficient in both directions — it admits live empty branches, and it says nothing about a peer still working on an already-merged branch.
