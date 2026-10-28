---
id: PLAN-243
type: plan
role: plan
title: "Plan: stage 1 of the done-contract (approve-time contract, kinds, write sets, start and finish)"
status: draft
priority: high
created: 2026-10-28
updated: 2026-10-28
tags: [governance-mechanism-fixes, issue-475]
parent: SPEC-263
phases:
  - {name: "P1 Implementation, tests first", description: "Kind and config, new-symbol flag, compile at approve, done reads the contract, write sets, finish, start, check and corpus kinds, migration command. One integrate"}
  - {name: "P2 Migration and foreign-criteria corrections", description: "Fixtures of tests and approved criteria that encode the removed behaviour; the live migration"}
  - {name: "P3 Shipped text and plan close", description: "Agents, skills, context and module docs name start, finish and the kinds; verify, rule apply, anchors, assess"}
links:
  - {id: PLAN-247, type: supersedes}
---
# Plan: stage 1 of the done-contract (approve-time contract, kinds, write sets, start and finish)

Implements `spec-done-contract-compiled-at-approve-task-kinds-write-sets` (AC-DCS1-1..26, parent). Decision: `adr-stage-1-the-done-contract-is-compiled-at-approve-with-task` (D28 to D33). Evidence: issue #475, which closes with stage 2, so this plan does not carry it. Supersedes `plan-done-contract-at-approve-task-kinds-start-finish-dispatch` and its 16 tasks (deprecated, not deleted). Each behaviour is described once, in its criterion; the task bodies say where it is built and which exact statements the stored falsifiers mutate. Code is checked against main at 82fa8eaa: the MCP server is gone, so no task touches it.

## Ordering in the initiative

Plan-level links are ignored by readiness (#464), so ordering is written as task-level `blocks` links:

- `task-close-plan-418-verify-apply-rule-changes-anchors-fresh` blocks the first tasks of this plan, A and B (every other task of P1 is behind them).
- `task-close-plan-stage-1-verify-apply-the-rule-changes-anchors` (L, this plan's last task) blocks `task-red-tests-and-v8-fixtures-for-declared-judge-visible-fields` (#414) and `task-red-tests-diagnosis-flags-issue-parts-and-label-listing` (#420).

## Tests first, inside each task (D33)

There are no separate red tasks. A red-only task cannot be archived legitimately under today's done floor: it holds no attested pass row, and a pass row that proves nothing (a syntax-only run recorded as a pass) games the floor. In a throwaway corpus the other routes failed too: a pass recorded on one task from another task's worktree is refused (`gate:corpus-write:foreign-provenance`) and one worktree carries one unlanded task. So every green task (A to I, K) does the whole cycle in one task and one worktree, which BR-1077 allows today: write the tests of its owned criteria in its own test file and commit them; capture the red of each owned AC command (`lore evidence --result expected-fail --capture`, runner summary showing failed tests); implement; `lore verify` the ACs; record an attested unfiltered whole-file pass of the test file. Each task anchors its test file. The first task to need a test file creates it and later tasks extend it, so it passes whole at every task's tip: `done-contract-approve-compiled.bun.test.ts` (A creates it with the shared fixture `tests/helpers/done-contract-fixture.ts`; B and C extend it), then one file each for D, E, F, G, H, I and K's unit test.

## How the plan lands (today's rules, one landing)

⛔ This plan is implemented and judged by TODAY's binary until the landing is rebuilt. `lore integrate` runs the done walk of the branch's tasks (BR-1356) in-process, moves the shared checkout to the new main (including the tracked `.lore/config.yaml` with the new `workflow.done_contract` keys, which the old binary's strict config schema rejects), rebuilds it (`workflow.integrate.post_refresh_command` is `bun run build`; the built `dist/lore` IS the `lore` on PATH), then runs the schema migration and starts the review batch with the new binary. So nothing may need the old binary after the landing: every task that lands through the integration branch must meet today's floors itself, with no `lore done` argument. The exact sequence:

1. **One landing.** Tasks claim from a worktree cut at main and merge the integration branch afterwards (today's BR-1353 refuses a first claim from a worktree carrying the integration branch's commits), and the orchestrator folds each finished branch into the integration branch by hand (stage 1 has no fold; see the decision log). `lore integrate integration/done-contract-stage-1` lands P1, J1 to J3 and K (every task that changes files) together, so main never holds the new code without the corrected fixtures. The done walk inside it archives A to I, J1 to J3 and K: each has a genuine red row (A to I and K from their own tests first; J1 to J3 from the failing run of the test files they correct, once `--kind` is required), attested passes, and a whole-file pass of every anchored test file. J4 (corpus commands only) was done before the landing, under today's rules, with `--declare-no-new-tests`.
2. **What integrate does after the rebuild, and why that is safe.** (a) `workflow.integrate.migrate_command` runs `lore migrate schema` with the branch binary: stage 1 adds NO store schema migration (the contract, kind and write set live in task `extra` JSON), so it is a no-op. (b) The detached review batch (BR-1379, `assess --where needs-review --close`) runs with the new floors; before step 4, read what it did to this plan and to other plans. Tasks of other plans that have no stored contract yet are skipped by a plan close with the floor `no-contract` (BR-1072), so no other plan is closed or its tasks archived until J5 has migrated them. This plan's own tasks are archived by then, and J5 and L are drafts it does not touch.
3. **Only then** any `bun run build`, `vitest` run or full-suite run in the shared checkout (vitest's global setup rebuilds a stale `dist/lore`; any build replaces the `lore` on PATH). The orchestrator runs the full suite once here.
4. **After the landing**, under the new binary: J5 and L, which stay drafts until now (a draft has no kind and no contract; `lore set <task> --kind corpus`, then `lore approve` compiles each contract). Integrate refreshes the shared checkout to main, so its detached HEAD is at main's tip; `git checkout --detach main` (BR-1342 does not refuse it) is only needed when main moved by some other route before a `lore finish` of a corpus task. J5's work is the migration itself (`lore migrate done-contract`, which needs no claim), so there is no circularity; L follows J5. Each is completed by `lore finish` and archived by `lore done`, with a script criterion as its real oracle (AC-DCS1-26, AC-DCS1-25) next to `corpus:files-unchanged`.

## Phases and tasks

| Phase | Task (slug) | Owns | Blocked by |
|---|---|---|---|
| P1 Implementation, tests first | A `task-kind-config-keys-and-the-create-and-set-surfaces-ac-dcs1-4` (also the shared fixture helper) | AC-DCS1-4, 9 | the #418 close task |
| P1 | B `task-lore-ac-add-and-set-accept-falsifier-new-symbol-ac-dcs1-3` | AC-DCS1-3 | A (B extends A's test file and fixture), #418 close |
| P1 | C `task-approve-compiles-and-stores-the-done-contract-no-red-a` | AC-DCS1-1, 2, 5 | A, B |
| P1 | D `task-lore-done-and-plan-close-read-the-stored-contract-retire` | AC-DCS1-6, 7, 8 | C |
| P1 | E `task-a-claim-declares-its-write-set-overlap-oracle-additions` | AC-DCS1-10, 11, 12 | D |
| P1 | F `task-lore-finish-runs-every-contract-oracle-reports-all-unmet-2` | AC-DCS1-15..18 | E |
| P1 | G `task-lore-start-creates-the-worktree-on-the-contract-base-2` | AC-DCS1-13, 14 | F |
| P1 | H `task-check-and-corpus-kinds-finish-in-the-shared-checkout-and` | AC-DCS1-19..21 | G |
| P1 | I `task-lore-migrate-done-contract-compiles-contracts-for-in-2` | AC-DCS1-22, 23 | H |
| P2 Migration and corrections | J1 `task-unit-tests-create-tasks-with-a-kind-and-drop-the-retired` | none (fixtures; keeps foreign criteria true) | I |
| P2 | J2 `task-integration-tests-create-tasks-with-a-kind-and-drop-the` | none (fixtures) | I |
| P2 | J3 `task-end-to-end-and-http-tests-create-tasks-with-a-kind-and` (e2e, http, support, helpers, fixtures, dashboard e2e seed, scripts) | none (fixtures) | I |
| P2 | J4 `task-correct-or-supersede-the-approved-criteria-that-encode-the` (corpus, before the landing) | the foreign-criteria list of the spec | J1, J2, J3 |
| P2 | J5 `task-run-lore-migrate-done-contract-on-the-live-corpus-and` (corpus, after the landing) | AC-DCS1-26 | J4, K |
| P3 Shipped text and plan close | K `task-shipped-agent-skill-and-context-text-and-module-docs-name` (lands with P1 and P2) | AC-DCS1-24 | I, J1 (J1's directory anchor contains K's unit test file) |
| P3 | L `task-close-plan-stage-1-verify-apply-the-rule-changes-anchors` (corpus, after the landing) | AC-DCS1-25 | J5 |

Every criterion is owned by a task that runs after the commands it tests exist: the clauses that need `start`, `finish` or a finished claim live in AC-DCS1-13, 15 and 18, whose owners (G, F) come after the write-set task E, and AC-DCS1-7 asks only for what exists when D runs. The P1 tasks are chained because they share files (`task-workflow-service.ts`, `adapters/cli/index.ts`, `app.ts`, `core/src/task-workflow.ts`, the shared test file); B follows A (it extends the approve test file and A's fixture). The new modules (`done-contract-compile.ts`, `done-contract-service.ts`, `task-start-service.ts`, `task-finish-service.ts`, `done-contract-migration-service.ts`, `core/src/done-contract.ts`) are anchored by the task that creates them, and the stored falsifier paths of the criteria name exactly these files. A task that splits one of them corrects the criterion first with `lore ac set --correction`.

## Why the P2 fixture tasks are large

`lore create task` now requires `--kind` and `--declare-no-new-tests` is gone, so every test that creates a task through the CLI (about 105 files under `packages/lore/tests`, plus the dashboard e2e seed and repository scripts) or archives with the flag (about 20) changes. The three fixture tasks anchor whole directories (the 50-anchor cap would not fit a list) and each requires a repository-wide search at its end for `create task` without `--kind`.

## Plan close (L)

No build here (the landing's rebuild installed the new binary, and a build replaces the `lore` on PATH); `git checkout --detach main` if HEAD is behind; `lore verify` this plan and the specs of both foreign-criteria lists of the spec (the corrected ones and the re-verified ones; AC-DCS1-25 fails at this point by design, it cites no changed rule); `lore rule apply` the spec (13 modifies, 4 adds; apply gates only on this spec's own criteria); `lore finish` of L runs AC-DCS1-25 after the apply; `lore anchor add` the six new modules (`core/src/done-contract.ts` and the five new files under `service/`) to the spec; `lore assess`; archive the plan. Close tasks stay until stage 2.

## Measurement

Before and after, with the O5 metrics of `knowledge-experiment-results-overhead-cost-reuse-and-safety`: refusals per task before archival, words of hand-written dispatch per task, orchestrator calls per landed task, subagents for tasks that change no file. The baseline is the plan-418 execution; the after-measure is the next plan run with `start` and `finish`.

## Decisions log

- D28, D29, D30 (user): see the ADR. D32 (user): two stages; this is stage 1, checked by the independent reviewer before the user approves.
- D33 (user): no fake pass rows. A red-only task has no legitimate close path under today's floor, so there are no separate red tasks; each task writes its tests first, records the expected-fail run, implements and records the whole-file pass in one worktree (BR-1077 allows it).
- User, review of the draft: the MCP server is out of scope (removed from main); the red-waiver flag is `--red-waiver` (citty reads `--no-<x>` as a negation); the shared checkout is detached, so check and corpus `finish` tests "HEAD equals main's tip and the tree is clean"; a finished claim keeps its lease until `done` but does not count in overlap judgement; the plan's own tasks land under today's rules (see above).
- The plan adds a rule change the first draft missed: BR-1353 refuses a first claim from a worktree carrying commits not on main, which refuses every worktree cut at the plan's integration branch (proved in a throwaway corpus: `gate:task-claim:first-claim-off-main`). It is modified to accept commits on the plan's integration branch (AC-DCS1-14, task G); until it lands, tasks of this plan claim from a worktree at main and merge the integration branch afterwards.
- Known limitation of stage 1 (accepted by the user): there is no fold. A finished claim stops counting in overlap only once its commit is in the integration branch, and stage 2's `land` is the verb that puts it there. Until then the orchestrator folds each finished task branch by hand before the next chained task claims: `git -C <int-worktree> merge --ff-only <branch>`; task K's shipped text says so (AC-DCS1-24). A task that skips the fold is refused `gate:task-claim:anchor-overlap` if it touches the same files.
- `lore done` of a task whose claim ran `finish` refuses `finish-stale` when commits were added after it (AC-DCS1-18, task F), so no commit lands untested through a finished claim.
- Fixture tasks J1 to J3 record a genuine red (the failing run of the test files they correct, after `--kind` became required) so the done walk of integrate archives them with no declaration; an old-binary `lore done` after the landing is impossible, because the landed config makes the old binary refuse every command.
- Three tasks run corpus commands only (J4, J5, L) and have no file anchors. J4 is the last use of the no-branch claim under today's rules; J5 and L run under the new rules after the landing and are the first corpus tasks completed by `lore finish`.
