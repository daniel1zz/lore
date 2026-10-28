---
id: PLAN-247
type: plan
role: plan
title: "Plan: done-contract at approve, task kinds, start/finish/dispatch/land verbs (D28)"
status: deprecated
priority: high
created: 2026-10-27
updated: 2026-10-28
tags: [governance-mechanism-fixes, issue-475]
parent: SPEC-261
phases:
  - {name: "P1 Red", description: "Failing tests for AC-DCT-1..10 and AC-LND-1..8, recorded as runner-produced reds"}
  - {name: "P2 Contract, kinds and implementer verbs", description: "Compile at approve with kind; finish and finish --red; check/corpus completion; start; contract migration. One integrate"}
  - {name: "P3 Land, dispatch, log, drift", description: "Execution log; dispatch; land both routes with plan close; finished-task review; drift at start; close-task migration. One integrate"}
  - {name: "P4 Shipped text", description: "Module docs and shipped guidance name the new verbs, not close tasks or declare-no-new-tests"}
links:
  - {id: SPEC-262, type: implements}
---
# Plan — done-contract compiled at approve, task kinds, and the start/finish/dispatch/land verbs (D28)

Implements `spec-done-contract-compiled-at-approve-task-kinds-and-the-start` (AC-DCT-1..15, parent) and `spec-land-dispatch-execution-log-and-drift-check-on-the-done` (AC-LND-1..10, implements link). Decision: `adr-done-contract-compiled-at-approve-with-task-kinds-and-start` (D28). Evidence: issue #475.

## Ordering in the initiative

Starts after plan #418 lands and before the #414 and #420 plans. Ordering is written as task-level `blocks` links, because plan-level links are ignored by readiness (#464):

- `task-close-plan-418-verify-apply-rule-changes-anchors-fresh` blocks this plan's first task (the red-test task).
- This plan's last task (shipped text and docs) blocks the first task of the #414 plan (`task-red-tests-and-v8-fixtures-for-declared-judge-visible-fields`) and of the #420 plan (`task-red-tests-diagnosis-flags-issue-parts-and-label-listing`).

⛔ The plan is implemented with TODAY's workflow: its own implementers use claim, evidence, release and done (the new verbs do not exist yet). Each task lands through the plan's declared integration branch; phases P2 and P3 each land as one integrate. This plan has no close task by design (D12): its close is the last task's landing plus `lore set` of the plan.

## Overview

The contract is compiled at approve and stored on the task; every later step reads it. Capability and production wiring are one unit in every task below: a task that adds a service also registers it in `app.ts`, the CLI registry and its command file, and its AC runs through the compiled command, never through the service alone.

## Invariants (plan-level, PI-n; the specs' own I and J invariants keep their labels)

| # | Invariant | Checked by |
|---|---|---|
| PI-1 | One copy of each done predicate: finish and done import the same functions | AC-DCT-7, plus the Done-when search in the compile and finish tasks |
| PI-2 | A contract is never partially compiled | AC-DCT-2, AC-DCT-3 |
| PI-3 | Check and corpus tasks never create a worktree | AC-DCT-4, AC-DCT-11 |
| PI-4 | Main moves only through integrate; the integration branch is created by start and advanced by land | AC-LND-2, AC-LND-3, AC-LND-9 |
| PI-5 | The task body stays locked; only lore appends the log | AC-LND-6 |
| PI-6 | Evidence comes only from the runner's exit status | AC-DCT-7, AC-DCT-8 |

## Tasks and the integration branch

All tasks land through the plan's declared integration branch `integration/done-contract`. Ownership of acceptance criteria (the ac_scope that compiles):

| Phase | Task | ACs |
|---|---|---|
| P1 | `task-red-tests-contract-compile-kinds-start-finish-retired-flag` | AC-DCT-1..15 (red) |
| P1 | `task-red-tests-dispatch-land-both-routes-plan-close-execution` | AC-LND-1..10 (red) |
| P2 | `task-approve-compiles-and-stores-the-done-contract-tasks-carry` | AC-DCT-1, 2, 3, 15 |
| P2 | `task-lore-finish-runs-every-contract-oracle-reports-all-unmet` | AC-DCT-6, 7, 8 |
| P2 | `task-check-and-corpus-kinds-finish-without-a-worktree-declare` | AC-DCT-4, 9, 11 |
| P2 | `task-lore-start-creates-the-worktree-on-the-contract-base` | AC-DCT-5 |
| P2 | `task-a-claim-declares-its-write-set-overlap-oracles-and-edit` | AC-DCT-12, 13, 14 |
| P2 | `task-lore-migrate-done-contract-compiles-contracts-for-in` | AC-DCT-10 |
| P3 | `task-execution-log-lore-appends-landed-superseded-and-evidence` | AC-LND-6 |
| P3 | `task-lore-dispatch-prints-the-complete-subagent-prompt-from-the` | AC-LND-1 |
| P3 | `task-lore-land-main-route-integrate-verify-archive-and-clean` | AC-LND-2 |
| P3 | `task-lore-land-integration-branch-route-fold-ff-else-merge-and` | AC-LND-3, 4, 9, 10 |
| P3 | `task-finished-tasks-get-a-deterministic-contract-check-an` | AC-LND-7 |
| P3 | `task-lore-start-checks-drift-since-approve-prints-the-anchors` | AC-LND-8 |
| P3 | `task-lore-migrate-retire-close-tasks-deprecates-unclaimed-close` | AC-LND-5 |
| P4 | `task-module-docs-and-shipped-guidance-name-start-finish` | none (docs) |

## Plan close (bootstrap, no close task)

This plan removes the close-task concept, so it has none. Its own close is done by the orchestrator after the last task lands: `lore rule apply` for each of the two specs (applying the change sets: BR-1357, BR-1468, BR-206, BR-209, BR-199, BR-130, BR-1072, BR-1313, BR-285 and the new drift rule), the code-anchor check, assess, then `lore set` of the plan to archived. A rule apply is refused until every criterion citing a changed rule has an attested pass, which the tasks' verify runs provide.

## Phases

- **P1 Red**: failing tests for AC-DCT-1..15 and AC-LND-1..10, written first and recorded as runner-produced reds.
- **P2 Contract, kinds and implementer verbs**: contract compile at approve with the kind field; `finish` (with `--red`); check/corpus completion and retirement of `--declare-no-new-tests`; `start`; contract migration.
- **P3 Land, dispatch, log, drift**: execution log; `dispatch`; `land` main route; `land` integration route with plan close; deterministic finished-task review; drift check at start; close-task migration.
- **P4 Shipped text**: CLAUDE.md module docs and shipped guidance name the new verbs and no longer name close tasks or `--declare-no-new-tests`.

## Measurement

Before/after with the O5 metrics of `knowledge-experiment-results-overhead-cost-reuse-and-safety`: refusals per task before archival, words of hand-written dispatch per task, orchestrator calls per landed task, and subagents run for tasks that change no file. The baseline is the plan-418 execution; the after-measure is the next plan run with the new verbs.

## Decisions log

- D28 (user): the direction and the breaking changes.
- D29 (user): a claim declares its write set (spec 1, D9 option a, AC-DCT-12 to AC-DCT-14; task `task-a-claim-declares-its-write-set-overlap-oracles-and-edit`); no reopen of locked tasks. The standing dispatch rules live in `packages/lore/assets/dispatch-standing-rules.md`.
- D30 (user): the contract is fixed at approve and only extended by declared write-set test files (AC-DCT-13); a code task declares no red run, with a reason, at approve (AC-DCT-15); the migration resolves every close task (AC-LND-5), so plan close has no close-task case (AC-LND-4).
- Red tasks and the unfiltered-pass floor (user, option a): the red tasks anchor their test files, which pass only after P2 and P3 land; the landing of the integration branch runs verify and done for every task of the branch together (BR-1356), so the floor is met at the landed commit. If the floor blocks a red task before that, the fallback is to move the test-file anchors to the green tasks.
- The new files `done-contract-service.ts`, `land-service.ts`, `dispatch-service.ts`, `execution-log-service.ts`, `close-task-migration-service.ts` are anchored by the tasks that create them, so no two tasks anchor one file in conflict: the implementer verbs share `done-contract-service.ts`, so the tasks that share files are chained by `blocks` links (P2 and P3 are each one chain). The stored falsifier paths of the ACs name `done-contract-service.ts`; a task that splits that module corrects the AC with `lore ac set --correction` before approve (the contract compile would refuse a stale path).
