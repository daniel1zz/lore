---
id: ADR-066
type: adr
role: decision
title: "Done-contract compiled at approve, with task kinds and start/finish/dispatch/land verbs"
status: deprecated
priority: high
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PRD-001
links:
  - {id: SPEC-261, type: informs}
  - {id: SPEC-262, type: informs}
---
> ⚠ INVALIDATED 2026-10-28T09:57:37.120Z — superseded by adr-stage-1-the-done-contract-is-compiled-at-approve-with-task

## Context

Every task's done-requirements surface only at `lore done`: red run or no-new-tests declaration, an attested UNFILTERED pass of each anchored test file, typecheck, a landing on the right base. Everything between approve and done is translated by hand by the orchestrator (dispatch prompts of 1-2k words, hand-made integration branches, a subagent to record evidence, a worktree and claim for tasks that change no file). Issue #475 holds the evidence from session 7903287b:

- `task-close-plan-356-verify-apply-rules-close-the-four`: `lore done` refused three times in turn; a subagent was dispatched only to record evidence; the task body was stale and locked; the AI review rejected it and `lore approve` passed anyway with no reason (#407, #408, #195).
- Plan `plan-per-call-run-identity-verified-by-process-ancestry-418`: a wrong falsifier path (AC-RV-7), a falsifier naming a non-existent `refuseCall`, a task anchoring a test file another task deletes, a task describing its mechanism wrongly. A read-only freshness agent was needed.
- Tasks that change no file still run the full code ceremony (#472: corpus-only tasks have no legitimate executor).
- Prior measurement: experiment O5 in `knowledge-experiment-results-overhead-cost-reuse-and-safety`, used as the before/after measure.

The cost is caused by LATE surfacing: the same facts (anchors, ac_scope, spec ACs, plan integration branch) are known at approve time but only judged at done time.

## Decision (D28 and D29, decided by the user, 2026-10-27; breaking changes allowed)

Compile the done-contract when the task is approved, and make every later step read it.

1. `lore approve <task>` computes and stores the contract: base branch (main or the plan's integration branch), required oracles (the AC verify commands, an unfiltered run of every anchored test file, typecheck), whether a red run is required, and the landing route. Approve refuses when the contract cannot be compiled.
2. Task kinds `code | check | corpus` replace `--declare-no-new-tests` and the no-branch claim. A check task runs its oracles at main's head and is completed by the orchestrator with no worktree or subagent.
3. Implementer verbs `lore start` and `lore finish`; orchestrator verbs `lore dispatch` and `lore land`. Claim, evidence, verify and release stay as low-level commands.
4. The task record is a locked intent body plus an execution log lore appends to. Finished tasks get a deterministic contract check instead of an AI review.
5. `lore start` diffs the anchors' files between the approve-time commit and the base, recompiles the contract and refuses on a missing falsifier literal.
6. (D29, D30) A claim declares the files it will touch (its write set, by default all approved anchors). The write set judges overlap only; the oracle set is the approve-time contract plus any test files the write set adds and never shrinks; the edit hook's declarations extend the write set, not the task's anchors, so the 50-anchor cap applies only to approved anchors. Locked tasks are not reopened. The contract is fixed at approve and changes only by the drift check at start and by those declared additions.
7. (D30) A code task requires a red run unless it declares no red run, with a reason, at approve; the declaration is part of the contract and `done` and `finish` never raise it. A one-time migration resolves every existing close task (release claim, move evidence to the plan, deprecate), so no close-task rule remains.
8. (D29) The standing dispatch rules live in the shipped file `packages/lore/assets/dispatch-standing-rules.md`.

Two specs carry the design (contract, kinds and start/finish; then land, dispatch, execution log and drift check); both link to this ADR with `implements`.

## Options compared

| Option | Surfaces requirements at | Enforced without a human | Removes hand-written dispatch / integration branches | Removes subagents for check tasks | Verdict |
|---|---|---|---|---|---|
| A. Prompt or skill checklists only | when an agent remembers | no: a checklist is advice | no | no | Rejected |
| B. `lore done --check` preflight only | when someone runs it | partly (read-only) | no | no | Rejected |
| C. Contract at approve + kinds + verbs (chosen) | approve, then every verb reads the same record | yes: refusal at approve, start, finish | yes (`dispatch`, `land`, `start`) | yes (`check` kind) | Chosen |

- A fails because the cost is late surfacing and a checklist has no enforcement point.
- B shows the unmet list earlier but still leaves hand-written dispatch, manual integration branches and a subagent per check task.
- C has a larger change surface (new verbs, task schema) and breaks existing task flows; this is accepted by the user, with a migration in the specs.

## Consequences

- Spec 1 modifies BR-206 (red decided once at approve) and BR-130 (overlap judged on write sets, between different tasks). Modifies baseline rules BR-1357, BR-1468, BR-206, BR-209, BR-199, BR-130 (spec 1) and BR-1072, BR-1313, BR-285 plus a new drift rule BR-1484 (spec 2); none is retired whole. The specs are the authority for the wording.
- `lore done` remains as the low-level terminal step and keeps every floor; `finish` and `land` call the same predicates, so there is one copy of each check (no second implementation).
- The close-task concept (a task per plan that runs verify, rule apply, anchors) is removed: `lore land` runs plan close when the last task lands.
- In-flight approved tasks need a migration; the specs define it.
- New verbs are CLI only. `adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only` is a pending draft; this decision does not add MCP tools.
- Success is measured with the O5 metrics (refusals per task before done, dispatch prompt words, orchestrator calls per landed task, subagents for no-file tasks); the specs fix the measure.

## Alternatives rejected

- (a) Prompt or skill checklists only. Late surfacing is the cost, and a checklist is not enforced without a human.
- (b) A `lore done --check` preflight only. Leaves hand-written dispatch, manual integration branches and subagents for check tasks.
