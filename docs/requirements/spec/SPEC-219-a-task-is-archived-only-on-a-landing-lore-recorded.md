---
id: SPEC-219
type: spec
role: spec
title: "A task is archived only on a landing lore recorded; one working copy carries one unlanded task"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: [integrate, done, claim]
---
## Overview/Goal

A task is archived only when lore itself recorded that its work landed. `lore integrate` is the only way main advances (BR-1245), so the landing it records is the single authority for "this task's work is on main". Today `lore done` instead infers it from the claimed working copy's current head (BR-1291), and `lore integrate` attributes a landing by matching branch names. The inference fails both ways:

- It refuses a landed task when the working copy holds a second task's unlanded commits (2026-10-19: `task-export-never-falls-back-to-a-title-name-for-an-unnumbered` landed as `export-only`, b17a49f1, and `lore done` still refused with `[floor: unmerged-branch]`).
- It passes an unlanded task when the working copy or branch was deleted (BR-1291's "cannot be measured, archived anyway" clause).

End state:

1. One working copy carries one unlanded task. A claim naming a working copy is refused while another task's claim named that copy and has not landed and is not archived or deprecated. Branch and task therefore correspond one to one, and work is never split across branches to land it.
2. `lore integrate` records a landing on every task whose claim history named the landed branch or its working copy, including when the branch is found already integrated and a claimant has no landing yet, and prints the tasks it recorded.
3. `lore done` (and `lore set --status archived`, plan close) requires, for a task whose claim named a working copy, a landing record whose landed commit is on main. If the claimed branch still exists and has commits not on main, it refuses too (work committed after the landing). There is no fail-open path: an unmeasurable state refuses. The requirement's fixed name is `not-landed`.
4. BR-134 drops its clause that one actor holding several tasks from one working copy never trips the same-name check: under item 1 that situation no longer exists, so the clause would describe an impossible state.
5. The fallback that searches main's first-parent log for `merge(<name>)` commits by candidate names is deleted; nothing reconstructs landings from history.

No compatibility with landings recorded before this change is kept: a task claimed before it and still open is closed by landing its branch again (integrate records on an already-integrated branch).

## Scope

In: `integrate-service.ts` landing recorder and its already-integrated path, `task-workflow-service.ts` (recordLanding, landing lookup, `findUnlandedWorkFloor`, `checkDoneFloors`, claim refusal), `task-commit-range.ts` landing schema, `adapters/cli/commands/integrate.ts` and `done.ts` output, the claim gate, the integrate and archive leaves' rules, `spec-defect-clusters-round-1-done-floors-judge-real-runs-on` AC-DCL-1 (a).

Out: readiness of blockers through a plan's integration branch (BR-1313, a non-main landing target); worktree removal in `lore done`; `measureAnchorRemovals`.

## Acceptance Criteria

Structured criteria are recorded with `lore ac add` (AC-LRD-1..4).


## Acceptance Criteria (structured)

- [⚑] [script] AC-LRD-1: In a throwaway repo and corpus: (a) a task whose branch content landed only via a cherry-picked branch is refused by lore done with exit 4 and floor name not-landed; (b) a task whose landing is recorded but whose branch got one more commit is refused not-landed; (c) a task whose landing is recorded and whose branch is deleted archives; (d) a task with no landing whose working copy and branch were deleted is refused not-landed (no fail-open); (e) lore set --status archived refuses (a) with the same name.
  script: test — bun run test:file packages/lore/tests/integration/landing-record-decides-done.bun.test.ts && echo 'AC-LRD-1 PASS: done decides from the recorded landing only'
  other_command=1
- [⚑] [script] AC-LRD-2: lore integrate on a branch claimed by a task records extra.landing (branch, branch_head, main_before, main_after, landing_commit) on that task and prints its slug; re-running integrate on the already-integrated branch records a landing on a second claimant of that branch that had none and exits 0; a branch no claim named prints that the landing names no task.
  script: test — bun run test:file packages/lore/tests/integration/integrate-records-landing-on-claimants.test.ts && echo 'AC-LRD-2 PASS: integrate records landings on every claimant'
  other_command=3
- [⊘] [script] AC-LRD-3: lore claim of a second task naming a working copy whose earlier claimant is unlanded and not archived exits 4 naming the first task and writes nothing, for the same actor and the same session; after the first task's landing is recorded on a commit on main, the same claim succeeds.
  script: test — bun run test:file packages/lore/tests/integration/claim-one-unlanded-task-per-worktree.bun.test.ts && echo 'AC-LRD-3 PASS: one working copy carries one unlanded task'
  other_command=6
- [⚑] [script] AC-LRD-4: No code reconstructs a landing from main's history or reads the claimed working copy's head to decide archival: findLandingInMainLog, findUnlandedWorkFloor, firstParentLog and landing_unresolved no longer exist in packages/lore/src, and no floor is named "unmerged-branch".
  script: other — ! grep -rnE 'findLandingInMainLog|findUnlandedWorkFloor|firstParentLog|landing_unresolved|"unmerged-branch"' packages/lore/src && echo 'AC-LRD-4 PASS: no history reconstruction or worktree-head inference remains'
  other_command=3
