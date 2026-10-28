---
id: SPEC-262
type: spec
role: spec
title: "Land, dispatch, execution log and drift check on the done-contract"
status: deprecated
priority: high
created: 2026-10-27
updated: 2026-10-28
tags: []
---
# Land, dispatch, execution log and drift check on the done-contract

## Overview/Goal

Part 2 of D28 and D29 (`adr-done-contract-compiled-at-approve-with-task-kinds-and-start`), on top of part 1 (`spec-done-contract-compiled-at-approve-task-kinds-and-the-start`: contract, kinds, start, finish, claim write set). The orchestrator's hand work becomes two verbs, `lore dispatch` and `lore land`; the task record gains an execution log written by lore; `lore start` checks drift since approve; the close-task concept is removed, and a one-time migration resolves every existing close task (AC-LND-5), so no close-task rule remains in plan close (AC-LND-4). Evidence: issue #475. Each behaviour is defined once, in its acceptance criterion; this text gives the reasons, the invariants and the decisions and refers to criteria by id.

### Problem (observed in session 7903287b)

- The orchestrator hand-writes 1-2k-word dispatch prompts, repeating standing rules and the branching base.
- Integration branches are created, fast-forwarded and merged by hand: `lore plan integration-branch` only records a name. An implementer's `git reset --hard` is refused by a safety hook only after the attempt.
- Plan 356 needed a close task (`task-close-plan-356-verify-apply-rules-close-the-four`): three `lore done` refusals, a subagent only to record evidence, a stale locked body, an AI review that rejected it, and an approve that passed with no reason (#407, #408, #195).
- On plan 418: a wrong falsifier path (AC-RV-7), a non-existent `refuseCall`, a test file anchored by one task and deleted by another, a mechanism described wrongly; a read-only freshness agent was dispatched.
- Prior measure: `knowledge-experiment-results-overhead-cost-reuse-and-safety` (O5).

## Scope

In scope: `dispatch` (AC-LND-1); `land` on both routes (AC-LND-2, AC-LND-3, AC-LND-4, AC-LND-9, AC-LND-10); the execution log (AC-LND-6); finished-task review (AC-LND-7); drift check at start (AC-LND-8); close-task migration (AC-LND-5). Out of scope: the contract itself (part 1). CLI only.

## Design

`land` composes existing capabilities and adds no second integrate path: main moves only through `IntegrateService` (BR-1342), whose completer already runs the done walk for a branch's tasks (BR-1356). The standing dispatch rules live in one shipped file, `packages/lore/assets/dispatch-standing-rules.md` (D29), which `dispatch` reads and never inlines (AC-LND-1). The execution log is the by-product of a landing, not a separate step (AC-LND-6). `check` and `corpus` tasks are finished by the orchestrator with `lore finish` (part 1) and are not landed (AC-LND-4). Each verb is registered in `adapters/cli/index.ts` with its service.

### Invariants

- J1: main moves only through integrate; the integration branch is created only by `start` and advanced only by `land`'s fold (AC-LND-2, AC-LND-3, AC-LND-9).
- J2: `land` is idempotent (AC-LND-2, AC-LND-10).
- J3: a failed step leaves earlier steps recorded and names the next command (AC-LND-10).
- J4: `dispatch` output is a pure function of the stored task, its contract and the shipped rules file (AC-LND-1).
- J5: the intent body of a task never changes; lore writes only the log and, for drift, the contract (AC-LND-6, AC-LND-8).

## Baseline rules (modified or added)

Each rule is stated in one sentence and agrees with its criterion. Applied at plan close through the spec's change set.

| Rule | Leaf | Change | Criterion |
|---|---|---|---|
| BR-1072 | close-a-plan | landing a plan's last open code task closes the plan | AC-LND-4 |
| BR-1313 | plan-the-work | `start` creates the integration branch and `land` folds into it | AC-LND-3, AC-LND-9 |
| BR-285 | approve-a-document | a task not yet past done needs no judgment override | AC-LND-7 |
| (new) BR-1484 | claim-a-task | starting a task checks drift since approve | AC-LND-8 |

## Migration (breaking)

`lore migrate retire-close-tasks` is defined in AC-LND-5. A plan with a recorded integration branch keeps it.

## Design Decisions (D-table)

| # | Decision | Options | Chosen / why |
|---|---|---|---|
| D10 | Standing rules (D29) | dispatch code / knowledge doc / shipped asset | shipped file `packages/lore/assets/dispatch-standing-rules.md`: versioned with the binary, one source |
| D11 | Fold | always merge / rebase / ff-else-merge | ff else merge: no history rewrite |
| D12 | Plan close | keep close task / manual / in land | in land: removes a task and a subagent |
| D13 | Finished tasks | AI review / deterministic check | deterministic: attested evidence, not opinion |
| D14 | Execution log | rewrite body / append log | append log: the body stays locked (#408) |
| D15 | Drift | freshness agent / start diff | start diff that refuses on a missing literal |
| D17 | Existing close tasks (user, D30) | leave claimed ones / migration resolves all | resolve all: release any claim, move the evidence to the plan's log, deprecate the task (AC-LND-5); plan close then knows only check and corpus tasks |
| D16 | Narrow write sets | here / part 1 | decided in part 1 (D9, D29): claims declare a write set |

## Acceptance Criteria

Structured criteria are on the spec (`lore ac list`); each is the single description of its behaviour.


## Acceptance Criteria (structured)

- [·] [script] AC-LND-1: lore dispatch <code task> prints, exit 0, one prompt holding the locked task body, the contract (base branch, every oracle command, red_required, route), the lore start and lore finish commands, and the standing rules byte-identical to packages/lore/assets/dispatch-standing-rules.md; a task with no contract, or of kind check or corpus, exits 4 (the check/corpus output names lore finish). False green guarded: a prompt that inlines its own copy of the rules passes a contains-check once, so the test edits the asset and asserts the output changes with it.
  script: test — bun run test:file packages/lore/tests/integration/cli/dispatch-verb.test.ts -t AC-LND-1 && echo 'AC-LND-1 PASS: dispatch prints contract and the single-source rules'
- [·] [script] AC-LND-2: lore land <task> on the main route, with the contract met, integrates the branch, runs verify for the task ACs on the landed commit, archives the task and removes its worktree in one command (exit 0); with an unmet contract it exits 4 naming every unmet item before anything moves and main is unchanged; a second run exits 0 and changes nothing. False green guarded: a land that archived without integrating would pass a final-state check, so the test asserts main contains the branch tip, the execution log holds landed and evidence-rebound entries, and the task is archived.
  script: test — bun run test:file packages/lore/tests/integration/cli/land-main-route.test.ts -t AC-LND-2 && echo 'AC-LND-2 PASS: main-route land integrates, verifies, archives, cleans'
- [·] [script] AC-LND-4: When the last open code task of a plan is landed, on the main route or on the integration-branch route (where the branch is first integrated into main and verify and done run for every code task of the plan), lore land then runs plan close (rule apply of the plan's spec, reported as skipped when the plan has no spec; code anchors check; assess), exit 0. While a check or corpus task of the plan is open, plan close is refused with exit 4 naming each; after it is finished, a re-run of lore land of the last code task runs plan close (exit 0). Landing a task that is not the last does none of these (main unchanged on the integration route, plan still open on both). A failing rule apply exits 4 naming the criteria without an attested pass. Plan close has no close-task case: no code path recognises a task by a close-task name. False green guarded: running plan close after every landing would pass the last-task case, so the not-last cases on both routes assert the plan status is unchanged, and the open-check-task case asserts the plan stays open until the re-run.
  script: test — bun run test:file packages/lore/tests/integration/cli/land-plan-close.test.ts -t AC-LND-4 && echo 'AC-LND-4 PASS: plan close runs once, at the last fold'
- [·] [script] AC-LND-5: A close task is a task whose slug starts with task-close-plan- and whose anchors name no file; only this one-time migration recognises it. lore migrate retire-close-tasks without --apply lists each close task with what it would do and writes nothing (exit 0); with --apply it releases any claim on each close task, appends its evidence rows to its plan's execution_log as an evidence-moved entry, deprecates the task, removes its blocks edges, and a second --apply writes nothing (exit 0). After --apply no task of the corpus is a close task. False green guarded: deprecating a claimed close task without releasing its claim or moving its evidence would pass a status check, so the fixture has a claimed and evidenced close task and the test asserts the claim is released, the rows are on the plan's log, and the task is deprecated.
  script: test — bun run test:file packages/lore/tests/integration/cli/migrate-close-tasks.test.ts -t AC-LND-5 && echo 'AC-LND-5 PASS: close tasks retired, claimed ones left'
- [·] [script] AC-LND-6: After lore land the task carries execution_log entries of kind landed (branch, tip, commit range); lore ac set --correction or lore ac supersede of an AC in the task's ac_scope appends a superseded entry naming the AC and the reason to each such task at the moment it runs; evidence re-bound to the landed commit is logged as evidence-rebound; a plan's execution_log accepts the evidence-moved entries of AC-LND-5. The task body bytes and body version are identical before and after; the only writes a locked task accepts are these lore-written log appends and the drift check's re-storage of done_contract, and a hand edit of execution_log or done_contract through lore set is refused with exit 4. False green guarded: a log written by rewriting the body would pass an entry check, so the test hashes the body before and after.
  script: test — bun run test:file packages/lore/tests/integration/cli/execution-log.test.ts -t AC-LND-6 && echo 'AC-LND-6 PASS: log appended, body unchanged'
- [·] [script] AC-LND-7: lore review of a task past done runs the deterministic contract check and calls no AI judge: it rejects with exit 4 naming each contract oracle lacking an attested pass at the landed commit, and approves (exit 0) when all are met. A task not yet past done (unstarted, claimed or in progress) is judged on intent only: evidence_completeness does not apply to it (#195, #408), and lore approve of it needs no override and records none in its audit row. False green guarded: an approve passing only through the override path exits 0, so the test asserts the audit row records no override.
  script: test — bun run test:file packages/lore/tests/integration/cli/finished-task-review.test.ts -t AC-LND-7 && echo 'AC-LND-7 PASS: finished tasks checked deterministically'
- [·] [script] AC-LND-8: lore start diffs the task anchors' files between compiled_at_commit and the base head; when a falsifier find-literal is missing at the base and not marked new-symbol it exits 4 naming the AC, path and literal, creating no worktree and no claim; otherwise it prints the diff, recompiles the contract, exits 0, and only when the recompiled contract differs from the stored one stores it and appends a drift entry holding the old and new values. False green guarded: printing the diff without refusing exits 0 on a stale falsifier, so the stale case asserts exit 4 and an unchanged worktree listing; an always-logging start is caught by the unchanged case asserting no drift entry.
  script: test — bun run test:file packages/lore/tests/integration/cli/start-drift.test.ts -t AC-LND-8 && echo 'AC-LND-8 PASS: start refuses a stale falsifier before creating anything'
- [·] [script] AC-LND-3: lore land on the integration-branch route folds the task tip into the plan's integration branch by fast-forward when the branch is an ancestor of the tip, else by merge (exit 0, entry kind folded in the execution log); a merge conflict exits 4 naming the conflicting files and leaves the integration branch unchanged; a task whose contract is unmet exits 4 naming every unmet item before the fold and leaves the branch unchanged. False green guarded: always merging would create merge commits on a fast-forwardable fold, so the test asserts the branch head equals the task tip in the ff case and has two parents in the merge case.
  script: test — bun run test:file packages/lore/tests/integration/cli/land-integration-route.test.ts -t AC-LND-3 && echo 'AC-LND-3 PASS: fold is ff else merge, conflict refused'
- [·] [script] AC-LND-9: lore start of the first task of a plan that declares integration/x, when that branch does not exist, creates it at main's head and bases the task worktree on it (exit 0); an existing branch is reused unchanged; a plan whose declared branch name is invalid is refused with exit 4 creating nothing. False green guarded: creating the branch at the task tip or at a stale commit would still print success, so the test compares the new branch head to main's head and the reuse case asserts the branch head is unchanged.
  script: test — bun run test:file packages/lore/tests/integration/cli/start-integration-branch.test.ts -t AC-LND-9 && echo 'AC-LND-9 PASS: start creates the integration branch at main head, reuses an existing one'
- [·] [script] AC-LND-10: When a step of lore land fails after an earlier step succeeded (on the main route verify refused after integrate; on the integration route verify refused after the fold), exit is 4, the earlier step stays recorded in the execution log, and the output names the next command to run; running land again after the cause is fixed resumes at the failed step and exits 0, and a third run changes nothing (exit 0). False green guarded: a land that rolled the step back would pass the final-state check but lose the log entry, so the test asserts the landed or folded entry exists after the failed run and that the branch head or main head is unchanged by the resume.
  script: test — bun run test:file packages/lore/tests/integration/cli/land-resume.test.ts -t AC-LND-10 && echo 'AC-LND-10 PASS: land resumes after a failed step and is idempotent'

## Code anchors

- packages/lore/src/service/integrate-service.ts
- packages/lore/src/service/plan-integration-branch-service.ts
