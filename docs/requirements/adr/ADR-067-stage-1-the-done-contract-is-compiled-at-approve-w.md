---
id: ADR-067
type: adr
role: decision
title: "Stage 1: the done-contract is compiled at approve, with task kinds, write sets and start/finish"
status: draft
priority: high
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PRD-001
links:
  - {id: ADR-066, type: supersedes}
---
## Context

Every task's done-requirements surface only at `lore done`: a red run or a no-new-tests declaration, an attested UNFILTERED pass of each anchored test file, typecheck, and a landing on the right base. Between approve and done the orchestrator translates them by hand (dispatch prompts of 1-2k words, hand-made integration branches, a subagent that only records evidence, a worktree and claim for tasks that change no file). Issue #475 holds the evidence from session 7903287b:

- `task-close-plan-356-verify-apply-rules-close-the-four`: `lore done` refused three times in turn; the body was stale and locked; the AI review rejected the task and `lore approve` passed with no reason (#407, #408, #195).
- Plan `plan-per-call-run-identity-verified-by-process-ancestry-418`: a wrong falsifier path, a falsifier naming a non-existent function, a task anchoring a test file another task deletes. A read-only freshness agent was needed.
- Tasks that change no file still run the full code ceremony (#472: corpus-only tasks have no legitimate executor).

The cost comes from LATE surfacing: anchors, `ac_scope`, spec ACs and the plan's integration branch are known at approve time but judged only at done time.

D28 (2026-10-27) chose the direction. D32 (2026-10-28) split it after an exhaustive review (49 defects, 15 blocking) into two stages. This ADR records STAGE 1 only and supersedes `adr-done-contract-compiled-at-approve-with-task-kinds-and-start`, which mixed both stages. Stage 2 (dispatch, land, plan close without close tasks, execution log, drift check at start) gets its own ADR after stage 1 lands.

## Decision

Compile the done-contract when a task is approved, and make `start`, `finish`, `claim` and `done` read it. The spec `spec-done-contract-compiled-at-approve-task-kinds-write-sets` carries every behaviour; this text gives the decisions and refers to criteria by id.

1. The contract is compiled and stored at `lore approve`; a contract that cannot be compiled refuses the approval and names every cause (AC-DCS1-1, AC-DCS1-2). It reads three project commands from config (`workflow.done_contract.install`, `.typecheck`, `.test_file`); a missing key is a refusal cause, never a silent skip (AC-DCS1-9).
2. Tasks have a kind, `code | check | corpus`, required at creation with no default and immutable once approved (AC-DCS1-4). Kind replaces the no-branch claim; the red waiver of decision 3 replaces `--declare-no-new-tests`.
3. A code task requires a red run unless the approver declares `--red-waiver "<reason>"` at approve (not `--no-red`: the argument parser reads `--no-<x>` as a negation and drops the value); the declaration is part of the contract, and `finish` and `done` never change it (AC-DCS1-5). `lore red-first` and `--declare-no-new-tests` are removed (AC-DCS1-6).
4. `lore start` (worktree on the contract base, install, claim, print the contract) and `lore finish` (runs every contract oracle itself, records runner-produced evidence, reports ALL unmet items at once, `--red` stage) are the implementer verbs (AC-DCS1-13 to AC-DCS1-18). A check or corpus task is completed by `finish` in the shared checkout and is never claimed (AC-DCS1-19 to AC-DCS1-21).
5. (D29, D30) A claim declares a write set, by default the task's approved anchors. The write set judges overlap only; the oracle set is the approve-time contract plus the test files the write set adds (those its branch changed), persisted on the task, and never shrinks (AC-DCS1-10 to AC-DCS1-12). A finished claim keeps its lease until `lore done` but no longer counts in overlap judgement (AC-DCS1-18).
6. `lore done` reads the stored contract (AC-DCS1-7); a migration compiles the contracts of in-flight tasks with no waiver (AC-DCS1-22, AC-DCS1-23).
7. Landing in stage 1 is unchanged: `lore integrate`, then `lore done`. Close tasks are NOT retired in stage 1.

The spec and this ADR are linked with `implements`.

## Options compared

| Option | Surfaces requirements at | Enforced without a human | Removes subagents for no-file tasks | Verdict |
|---|---|---|---|---|
| A. Prompt or skill checklists only | when an agent remembers | no | no | Rejected |
| B. `lore done --check` preflight only | when someone runs it | partly (read-only) | no | Rejected |
| C. Contract at approve, kinds, start and finish (chosen) | approve, then every verb reads the same record | yes: refusal at approve, claim, start, finish and done | yes (`check` and `corpus` kinds) | Chosen |
| D. One stage with dispatch and land (the superseded draft) | same as C | yes | yes | Rejected by D32: 49 defects, unreviewable in one pass; stage 1 delivers the contract first |

## Consequences

- Rules modified in effect: BR-130, BR-199, BR-205, BR-206, BR-207, BR-209, BR-1040, BR-1057, BR-1072, BR-1092, BR-1353, BR-1357, BR-1468; new rules BR-1487 to BR-1490 for approve-time compilation, kinds, finish and the migration. BR-1423 and BR-1291 are unchanged: a task with no claim is landed by BR-199's new clause. The spec's change set holds the wording and is the authority.
- `lore done` keeps every floor and `finish` shares its predicates: one copy of each check.
- Breaking changes (user, D28): `lore create task` requires `--kind`; `--declare-no-new-tests` and `lore red-first` are removed from the CLI (the MCP server no longer exists on main); a task approved before the change has no contract until `lore migrate done-contract --apply`.
- Tests and approved specs written against the removed behaviour are corrected in the plan (phase P2).
- D33 (user): no fake pass rows. A red-only task has no legitimate close path under today's done floor (it needs an attested pass), so the plan has no separate red tasks: each task writes its tests first, records the expected-fail run, implements and records the whole-file pass in one worktree.
- The `lore` CLI gains `start`, `finish` and `migrate done-contract`; it is the only command surface.
- Measure of success: O5 metrics of `knowledge-experiment-results-overhead-cost-reuse-and-safety` (refusals per task before done, dispatch prompt words, orchestrator calls per landed task, subagents for tasks that change no file), read after the next plan that runs with these verbs.

## Alternatives rejected

- (a) Prompt or skill checklists only: late surfacing is the cost, and a checklist has no enforcement point.
- (b) A `lore done --check` preflight only: still leaves a hand-written dispatch and a subagent for no-file tasks.
- (c) A grandfather waiver for tasks approved before stage 1: the contract would have two meanings; the migration lists what cannot compile instead (AC-DCS1-22).
- (d) Retiring close tasks now: needs `land` and automatic plan close, which are stage 2.
