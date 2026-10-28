---
id: SPEC-261
type: spec
role: spec
title: "Done-contract compiled at approve, task kinds, and the start/finish verbs"
status: deprecated
priority: high
created: 2026-10-27
updated: 2026-10-28
tags: []
---
# Done-contract compiled at approve, task kinds, and the start/finish verbs

## Overview/Goal

A task's done-requirements are known at approve time but surface only at `lore done`. This spec makes `lore approve <task>` compile and store them as the task's **done-contract**, adds task kinds `code | check | corpus`, gives the implementer `lore start` and `lore finish`, and lets a claim declare the files it will actually touch. Part 2 (`spec-land-dispatch-execution-log-and-drift-check-on-the-done`) covers `lore land`, `lore dispatch`, the execution log and the drift check. Decisions: D28 and D29, `adr-done-contract-compiled-at-approve-with-task-kinds-and-start`. Evidence: issue #475. Each behaviour is defined once, in its acceptance criterion; this text gives the reasons, the invariants and the decisions and refers to criteria by id.

### Problem (observed in session 7903287b)

- `task-close-plan-356-verify-apply-rules-close-the-four`: `lore done` refused 3 times in turn (no red run, so `--declare-no-new-tests`; then "test-file anchors with no attested UNFILTERED pass run"). A subagent was dispatched only to record evidence. Its body was stale, it was locked, the AI review rejected it, and `lore approve` passed anyway with no reason (#407, #408, #195).
- On `plan-per-call-run-identity-verified-by-process-ancestry-418`, found only at implementation time: AC-RV-7's falsifier path named the wrong file; a falsifier named a non-existent `refuseCall`; a task anchored a test file another task deletes; a task described its mechanism wrongly. A read-only freshness agent was dispatched.
- Tasks that change no file (`task-verify-ac-dc-6-against-the-landed-main-red-ledger`, the four plan-evaluation-1 experiments, the #356 close task) still need worktree, subagent, claim, evidence, release and done (#472).
- 2026-10-27: a fixture-only fix of two test files under `task-tool-server-verifies-harness-run-by-process-ancestry` was refused at claim (`gate:task-claim:anchor-overlap`) because a sibling task's accumulated anchors included `call-scope.ts#buildCallIdentity`, auto-added by the edit hook. The same day an implementer was blocked by the 50-anchor cap (`MAX_FILE_ANCHORS`, `packages/core/src/file-anchors.ts`).
- Prior measure: experiment O5, `knowledge-experiment-results-overhead-cost-reuse-and-safety`.

## Scope

In scope: the stored contract and its compile (AC-DCT-1 to AC-DCT-3, AC-DCT-11); kinds (AC-DCT-4, AC-DCT-11); `start` (AC-DCT-5); `finish` (AC-DCT-6 to AC-DCT-8); retirement of `--declare-no-new-tests` and the no-branch claim (AC-DCT-9); migration (AC-DCT-10); the claim write set (AC-DCT-12 to AC-DCT-14) and the no-red declaration (AC-DCT-15). Out of scope: part 2, and any reopen of a locked task (rejected in D9). CLI only (`adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only` is a pending draft).

## Design

The contract lives in `extra.done_contract` (fields in AC-DCT-1), written only by approve and, in part 2, by the drift check. A claim carries a **write set**, the files it will touch, by default all the task's approved anchors (AC-DCT-12). The write set judges overlap only (AC-DCT-12); it can add oracles for test files it adds but never removes one (AC-DCT-13); the edit hook's declarations extend it (AC-DCT-14); the task's approved anchors stay intent. Whether a code task requires a red run is decided once, at approve (AC-DCT-15). `finish` and `lore done` import the same predicates (I1). Both verbs are registered in `adapters/cli/index.ts` with their service, so no capability exists without its command.

### Invariants

- I1: one copy of each done predicate; `finish` and `lore done` share them.
- I2: the contract is fixed at approve and read everywhere else. It can change only by part 2's drift check (recompile at start) and by declared additions: test files a claim's write set adds (AC-DCT-13). It never shrinks, and `done` and `finish` never raise or waive a requirement.
- I3: no partial contract: a compile that cannot complete refuses with every cause (AC-DCT-2).
- I4: evidence comes only from the runner's exit status.
- I5: a check or corpus task is finished without a worktree or claim branch (AC-DCT-4, AC-DCT-11).
- I6: a claim's write set bounds what the claim may write; the task's anchors bound what the task was approved to do.

## Baseline rules modified (none retired whole)

Each rule is stated in one sentence and agrees with its cited criterion. Applied at plan close through the spec's change set.

| Rule | Leaf | Change | Criterion |
|---|---|---|---|
| BR-1357 | claim-a-task | claiming or starting prints the stored contract | AC-DCT-5 |
| BR-1468 | claim-a-task | a code task is claimed only on a branch; check and corpus tasks have no claim branch | AC-DCT-4, AC-DCT-9 |
| BR-206 | archive-a-task | a code task requires a red run unless it declared no red run at approve; the no-new-tests declaration is retired | AC-DCT-9, AC-DCT-15 |
| BR-209 | archive-a-task | `done` reports the first unmet requirement, `finish` all of them | AC-DCT-7 |
| BR-199 | archive-a-task | a check or corpus task's passing row counts at main's head after approval | AC-DCT-4, AC-DCT-11 |
| BR-130 | claim-a-task | claim overlap between tasks is judged on the claim write sets | AC-DCT-12 |

## Migration (breaking)

`lore migrate done-contract` is defined in AC-DCT-10. Existing tasks default to kind `code`. A task archived with the old flag keeps its stored reason.

## Design Decisions (D-table)

| # | Decision | Options | Chosen / why |
|---|---|---|---|
| D1 | Contract compiled at approve | at claim / at approve / at done | approve: the facts are known there and refusal is early |
| D2 | Kinds | declare flag / kind field / separate doc types | kind field: one vocabulary, resolves #472 |
| D3 | `finish` runs the oracles | agent records evidence / finish runs them | finish: attested by construction (I4) |
| D4 | `finish` reports all unmet | first unmet / all | all; `done` keeps first-unmet (BR-209) |
| D5 | New symbols | infer from absence / explicit flag | explicit `--falsifier-new-symbol` |
| D6 | `--declare-no-new-tests` | keep / retire | retire: the kind replaces it |
| D7 | Task approve override | keep / remove the need | remove the need (part 2, BR-285) |
| D8 | Surface | MCP tools / CLI only | CLI only |
| D9 | Follow-up claims (user, D29: option a) | (a) claim declares its write set and the gate judges that set; (b) `start --reopen --scope`; (c) as is | (a). (b) is not built: no reopen of locked tasks |
| D30a | Oracles under a write set (user) | write set shrinks the oracles / oracles fixed at approve plus declared additions | fixed plus additions: the oracle set never shrinks (AC-DCT-13) |
| D30b | No-red code tasks (user) | derive red from ac_scope or red-first / declare at approve | a code task requires a red run unless it declares no red run with a reason at approve; the declaration is part of the contract and `done` and `finish` never raise it (AC-DCT-15). The `lore red-first` action becomes unnecessary because red is the default |
| D30c | Second claim on the same task | judge by write-set overlap / lease rule | lease rule (BR-1040): while a claim on the task is fresh, a new claim by another run is refused unless stolen, so overlap never decides a same-task case; BR-130 and AC-DCT-12 therefore cover claims on different tasks only |
| D9a | The 50-anchor cap | write set replaces anchors as the judged set and has no count cap / cap stays on a write set | write set replaces anchors: it is claim-scoped and bounded by files actually edited; the cap stays on approved anchors, which are intent (AC-DCT-14) |

## Acceptance Criteria

Structured criteria are on the spec (`lore ac list`); each is the single description of its behaviour.


## Acceptance Criteria (structured)

- [·] [script] AC-DCT-1: lore approve of a draft task stores extra.done_contract with compiled_at_commit, kind, base_branch, oracles, red_required, no_red_reason, landing_route and new_symbols, exit 0. base_branch is the plan's integration branch when declared, else main. Oracles: for a code task, the verify command of every ac_scope AC, an unfiltered whole-file run of each anchored test file, and the project's typecheck command (bun run typecheck in this repository); for a check or corpus task, the ac_scope AC verify commands only. red_required is true for a code task approved without a no-red declaration (AC-DCT-15), false for a code task approved with one, and false for check and corpus. landing_route is main or integration-branch for a code task and none for check and corpus. False green guarded: a contract with an empty oracle list or a wrong red_required passes a field-presence check, so the test asserts the exact oracle ids and red_required for both kinds and both red declarations.
  script: test — bun run test:file packages/lore/tests/unit/service/done-contract-compile.test.ts -t AC-DCT-1 && echo 'AC-DCT-1 PASS: contract compiled with exact oracle ids and base'
- [·] [script] AC-DCT-2: lore approve of a task is refused with exit 4, writing nothing (no version, no contract), when the contract cannot be compiled, and the refusal names EVERY cause in one message: an anchor path absent from the compile commit that no task of the plan creates, a falsifier find-literal absent from its path and not marked new-symbol, an AC oracle file that another task of the plan deletes, an AC oracle file reserved as the test file of a different task whose ac_scope omits that AC, a contract with no oracle (cause no-oracle), a check or corpus task holding a file anchor (cause kind-anchor). Refusal name: done-contract-uncompilable. False green guarded: a refusal on the first cause only would pass a one-cause fixture; the fixture carries all six causes and asserts all six are named.
  script: test — bun run test:file packages/lore/tests/unit/service/done-contract-compile.test.ts -t AC-DCT-2 && echo 'AC-DCT-2 PASS: uncompilable contract refused with all causes, exit 4'
- [·] [script] AC-DCT-3: A falsifier find-literal that is absent from its path is accepted by approve (exit 0) only when the AC is marked --falsifier-new-symbol, and then the literal is stored in contract.new_symbols; unmarked it is the done-contract-uncompilable refusal (exit 4) naming the AC, the path and the literal. False green guarded: marking every AC new-symbol would make the refusal vanish, so the unmarked case is asserted refused in the same test file.
  script: test — bun run test:file packages/lore/tests/unit/service/done-contract-compile.test.ts -t AC-DCT-3 && echo 'AC-DCT-3 PASS: absent falsifier literal refused unless marked new-symbol'
- [·] [script] AC-DCT-4: A check task finished by lore finish run in the shared checkout, with no worktree and no claim branch, runs exactly the AC oracles of its ac_scope at main's head, records attested rows, archives the task (exit 0), and creates no worktree and no subagent. False green guarded: a finish that silently created a throwaway worktree would still archive, so the test compares the worktree listing before and after and asserts the recorded oracle list equals the ac_scope AC commands.
  script: test — bun run test:file packages/lore/tests/integration/cli/finish-check-kind.test.ts -t AC-DCT-4 && echo 'AC-DCT-4 PASS: check kind finishes at main head with no worktree'
- [·] [script] AC-DCT-5: lore start <code task> run from the shared checkout creates a worktree whose HEAD is the contract base (the plan integration branch when declared, main otherwise), installs dependencies, claims the task on the new branch, and prints the contract (oracles, red_required, base, route); exit 0. A task that is not approved is refused with exit 4 naming lore approve and creating no worktree. False green guarded: starting from main when the plan declares an integration branch would still print a contract, so the test compares the worktree HEAD to the integration branch tip.
  script: test — bun run test:file packages/lore/tests/integration/cli/start-verb.test.ts -t AC-DCT-5 && echo 'AC-DCT-5 PASS: start branches from the contract base and claims'
- [·] [script] AC-DCT-6: lore finish <task> run in a worktree with uncommitted changes (including an untracked file) is refused with exit 4 naming the changed paths, runs no oracle and records no evidence. False green guarded: a refusal that happens after the oracles ran would still exit 4, so the test asserts the evidence list is unchanged and no oracle process was spawned.
  script: test — bun run test:file packages/lore/tests/integration/cli/finish-verb.test.ts -t AC-DCT-6 && echo 'AC-DCT-6 PASS: finish refuses a dirty tree before running anything'
- [·] [script] AC-DCT-7: lore finish runs every contract oracle itself (captured, attested, unfiltered whole-file run per anchored test file, typecheck, every ac_scope AC) and, when more than one item is unmet, reports ALL unmet items in one output and exits 4; a fully met contract records the rows, releases the claim and exits 0. False green guarded: stopping at the first failing oracle exits 4 too, so the fixture has two failing oracles and the test asserts both names appear in one output.
  script: test — bun run test:file packages/lore/tests/integration/cli/finish-verb.test.ts -t AC-DCT-7 && echo 'AC-DCT-7 PASS: finish reports all unmet items in one go'
- [·] [script] AC-DCT-8: lore finish --red runs the contract's AC oracles before the implementation exists and records runner-produced expected-fail rows only when the runner summary shows at least one failed test (exit 0); when an oracle passes unexpectedly the stage is refused with exit 4 naming it and records nothing; a typed-in or exit-code-126/127 run is never recorded as red. False green guarded: recording red for a command that could not start would satisfy the red floor with no test run; the test uses a missing runner and asserts nothing is recorded.
  script: test — bun run test:file packages/lore/tests/integration/cli/finish-verb.test.ts -t AC-DCT-8 && echo 'AC-DCT-8 PASS: finish --red records runner-produced reds only'
- [·] [script] AC-DCT-9: lore done <task> --declare-no-new-tests <reason> exits 2 (usage error) naming the task kind as the replacement and writes nothing; a task archived earlier with the old flag keeps its stored reason; a no-branch claim on a code task is refused with exit 4. False green guarded: leaving the flag as a silently ignored option would exit 0, so the exact exit 2 and the stderr text are asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/done-declare-retired.test.ts -t AC-DCT-9 && echo 'AC-DCT-9 PASS: declare-no-new-tests is a usage error naming kind'
- [·] [script] AC-DCT-10: lore migrate done-contract without --apply lists every approved non-archived task with the contract it would store (or its causes) and writes nothing (exit 0); with --apply it stores one version per task, moves a task whose contract cannot compile back to draft with its causes listed, and a second --apply writes nothing (exit 0); --apply is refused with exit 4 and writes nothing while an uncompilable task holds a live claim or evidence, listing it. A migrated code task gets red_required true when it declared red-first or has an ac_scope, else false with no_red_reason migrated-before-D30; a task whose claim history is a no-branch claim and which holds no file anchor becomes kind check, while one holding a file anchor stays code and is listed with the cause. False green guarded: a preview that wrote would pass a content check, so the test compares the store version numbers before and after the preview, and the claimed uncompilable fixture asserts exit 4 with every task untouched.
  script: test — bun run test:file packages/lore/tests/integration/cli/migrate-done-contract.test.ts -t AC-DCT-10 && echo 'AC-DCT-10 PASS: migration is preview-first and idempotent'
- [·] [script] AC-DCT-11: A corpus task has landing_route none and no worktree: lore finish run in the shared checkout runs exactly its ac_scope AC oracles, records attested rows at main's head after its approval and archives it, exit 0; the same finish with an AC oracle failing exits 4 naming it and archives nothing. False green guarded: a corpus finish that skipped the AC oracles would archive with no row, so the test asserts a recorded attested row at the current main head.
  script: test — bun run test:file packages/lore/tests/integration/cli/finish-check-kind.test.ts -t AC-DCT-11 && echo 'AC-DCT-11 PASS: corpus kind finishes on its AC oracles at main head'
- [·] [script] AC-DCT-12: A claim declares the files it will touch: lore claim <task> --write-set <path> (repeatable), or lore start <task> --write-set <path>, records the set on the claim; a claim with no --write-set has all the task's approved anchors as its write set. The task-claim gate judges overlap only between the write sets of fresh claims by different runs on different tasks of the same plan (a second claim on the same task is governed by the lease rule BR-1040, not by overlap). With a sibling holding a fresh claim whose write set is {call-scope.ts} while the claimed task's anchors also include call-scope.ts, a claim with --write-set of two test files exits 0 and records them; a claim whose write set includes call-scope.ts, or a claim with no --write-set, exits 4 with gate:task-claim:anchor-overlap naming the sibling task and the overlapping path, writing nothing. False green guarded: judging by accumulated task anchors would refuse the first case and judging nothing would accept the others, so all three cases are asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/claim-write-set.test.ts -t AC-DCT-12 && echo 'AC-DCT-12 PASS: overlap is judged on the declared write set'
- [·] [script] AC-DCT-13: The oracle set of a claim is the approve-time contract's oracles plus an unfiltered whole-file run of each test file in the claim's write set that the contract does not already run; it never has fewer oracles than the contract. A fix-up claim writing two test files of a task anchored on three test files gets all three anchored runs plus the ac_scope AC oracles and typecheck, and a write-set test file the task does not anchor adds one more run; lore start prints that list and lore finish runs it and exits 0 on pass. False green guarded: a write set that replaced the anchored-test oracles would pass a pass-only check, so the test asserts the exact oracle list, that the third anchored file was executed, and that the added file was executed.
  script: test — bun run test:file packages/lore/tests/integration/cli/claim-write-set.test.ts -t AC-DCT-13 && echo 'AC-DCT-13 PASS: oracles follow the write set'
- [·] [script] AC-DCT-14: A claim's write set starts as all the task's approved anchors; lore anchor declare <task> <path> on a path outside it that another live claim holds exits 4 naming the holder task and writes nothing (the edit hook refuses the edit, BR-1092); on a free path it exits 0 and appends the path to the claim's write set, not to the task's anchors; declaring 60 free paths in one claim exits 0 and leaves the task's file_anchors unchanged, so the 50-anchor limit applies only to approved anchors. False green guarded: appending to the task anchors would pass a single declare but fail the 60-path case with the cap refusal, so the 60-path case is asserted.
  script: test — bun run test:file packages/lore/tests/integration/cli/anchor-declare-write-set.test.ts -t AC-DCT-14 && echo 'AC-DCT-14 PASS: declares extend the claim write set, not the anchors'
- [·] [script] AC-DCT-15: A code task requires a red run unless it declares none at approve: lore approve <task> stores red_required true; lore approve <task> --no-red "<reason>" stores red_required false and the reason in the contract (for example #474, a fixture-only fix whose pre-fix failure was in beforeAll), exit 0; a blank reason exits 2 and writes nothing; --no-red on a check or corpus task exits 4. lore done and lore finish never change red_required or its reason: a task with red_required true and no runner-produced red row is refused by both with exit 4, and with red_required false both accept it. False green guarded: a done that quietly accepted a missing red row would pass the false case, so the true case asserts exit 4 from both verbs.
  script: test — bun run test:file packages/lore/tests/unit/service/done-contract-compile.test.ts -t AC-DCT-15 && echo 'AC-DCT-15 PASS: red is declared once at approve'

## Code anchors

- packages/lore/src/service/task-workflow-service.ts
- packages/lore/src/adapters/cli/index.ts
