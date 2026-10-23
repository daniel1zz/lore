---
id: PLAN-214
type: plan
role: plan
title: "D3b: landing does the bookkeeping"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-20
tags: [redesign, integrate]
parent: SPEC-226
---
## Goal

Implement `spec-landing-does-the-bookkeeping-claims-start-from-main-parked`. Two tasks, run in parallel. Each task's file anchors are its ownership list; both use symbol anchors where they share a file.

## Shared contract

The parked state is `extra.parked = {at, by, reason}` on the task. LB-B writes it (`lore park`) and reads it in the holder query; a parked task with a held claim still holds. LB-A's claim deletes `extra.parked`, so claiming a parked task unparks it (BR-1354). After landing, a still-blocked task gets the floor name and the exact `lore evidence` command printed, and a done refusal never rolls the landing back (AC-LB-4).

## Tasks

- **LB-A, claim side (AC-LB-1, AC-LB-5).**
  - In `TaskWorkflowService.claim`: refuse a first claim from a worktree whose HEAD carries commits not on main (BR-1353), exempting the claim's recorded branch.
  - Print the definition of done (BR-1357). It is computed by the same predicates `lore done` uses (`evaluateDoneFloors` / `checkDoneFloors` in task-workflow-service.ts, and `@lore/core` attestation-completeness). Expose it on `lore claim --json` and `lore feed task-start`.
- **LB-B, landing side (AC-LB-2, AC-LB-3, AC-LB-4).**
  - Add a `lore park <task> --reason` verb that records the parked state on the task. Its exit code is 2 when `--reason` is missing.
  - The own-diff judgment ignores the unlanded branch of a parked task. Its BR-1346 refusal names the holder's state.
  - Make code anchors follow renames and refuse deletions (BR-1355). Use `git diff --name-status -M`.
  - After landing, run the done walk for each task of the branch (BR-1356).
  - Scope note: this covers spec and knowledge `code_anchors` only. A task's own `file_anchors` on a renamed or deleted path are left as they are, because landing archives the task.

## After both land (main agent)

Run `lore rule apply` on the spec, then `lore setup --yes`.
