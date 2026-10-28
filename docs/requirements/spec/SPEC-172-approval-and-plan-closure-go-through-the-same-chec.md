---
id: SPEC-172
type: spec
role: spec
title: "Approval and plan closure go through the same checks on every surface"
status: approved
priority: high
created: 2026-10-12
updated: 2026-10-28
tags: []
links:
  - {id: SPEC-097, type: relates-to}
---
# Approval and plan closure go through the same checks on every surface

## Goal

`lore set <doc> --status approved` (and MCP `lore_set`, HTTP `PATCH /api/docs/:id`, the dashboard write route) gives exactly the verdict `lore approve` gives on the same document and is recorded as an approval; closing a plan archives an open member task only when that task clears every floor `lore done` checks, and says, in human output too, which tasks it archived and which it left open and why; `lore archive --apply` applies the same floors to a closed plan's leftover tasks. Issues #65, #50, #47, #173.

## Why now (measured 2026-10-12)

- `CorpusService.set()` (`packages/lore/src/service/corpus-service.ts:2106`) handles a transition to `approved` in its own branch (`:2569-2612`): it runs only `spec-promote` (`:2587`) and the BR-1007 citation check (`:2609`). `ReviewService.approve` (`review-service.ts:676`) runs `enforceApprovalGate` (`:260`) → `enforceTypeGates` (`:279`): the judgment gate for `workflow.review.judgment_required_types` (default spec + adr, `:298`/`:429`), `spec-promote` (`:309`) and `plan-promote` (`:342-379`). So an unjudged ADR refused by `lore approve` is approved by `lore set --status approved` with exit 0, and `lore log` shows a plain `update` (#65); a plan under a draft spec is approved through MCP/HTTP/CLI-without-hook (#50). All four write surfaces reach `set()`: CLI `commands/set.ts:455,673`, MCP `tools.ts:1774,3541`, HTTP `routes.ts:803` (attribution via `resolveDocWriteOpts`), `dashboard-routes.ts:320-326` (`expectedVersion` → 409 STALE_VERSION).
- The plan-close cascade (`corpus-service.ts:3061`, `cascadeArchiveOnPlanClose` `:3082`, targets from `@lore/core` `computePlanCloseCascadeTargets` in `archive-candidates.ts`) archives every member task that holds no fresh claim, with none of `lore done`'s floors (`task-workflow-service.ts` `done` `:3304` / `_doneImpl` `:3318`: attested pass, red-first, no-new-tests, unfiltered test-file run). `commands/set.ts:705-720` prints no cascade line in human output; the cascade is visible only in `--json` (#47).
- `lore archive --apply` (`commands/archive.ts:94` recomputes `computeArchiveCandidates`, then `CorpusService.archiveSweepCandidate` `corpus-service.ts:3221` writes each) archives an R4 straggler task (open task under a closed plan) with no floor either (#173), so a task the fixed cascade skips would be archived by the next sweep.

## Baseline

New BR-1071 (`baseline-approve-a-document`) and BR-1072 (`baseline-close-a-plan`, covers the cascade and the sweep). Retired as superseded: BR-311 and BR-82 (→ BR-1071), BR-215 (→ BR-1072). Statements repointed in place (same meaning, new reference): BR-1026, BR-212, BR-214. Chosen over rewriting the defect rules in place because each of those ids stated the opposite behaviour (a flipped statement under a kept id would make every earlier mention of the id mean something else); BR-215 is cited by AC-097-2 of a locked spec, which keeps citing the retired id that matches what it asserts.

## Scope

- `CorpusService.set()`: a caller-requested transition to `approved` delegates to an injected `ApprovalPort` that app.ts binds to `ReviewService.approve` (the whole check path and the approve write), passing the caller's `expectedVersion` and actor attribution. The `set()`-local `spec-promote` and BR-1007 blocks on that path are removed — one path, not two.
- A `set()` patch that requests `approved` together with another field whose VALUE differs from the stored value is refused before any write; a field echoed with its stored value is ignored (D4).
- `TaskWorkflowService.checkDoneFloors` holds the four floors; `_doneImpl` calls it and returns its error unchanged. `CorpusService` reaches it through an injected `DoneFloorPort`.
- Plan-close cascade: each task target is checked through the port; a failing task is skipped with the floor named. `PlanCloseCascadeResult.skipped[]` entries gain `floor`.
- `CorpusService.archiveSweepCandidate` checks an R4 task candidate through the same port; `lore archive --apply` lists floor-refused tasks and leaves them open (D8).
- `lore set <plan> --status archived` human output lists archived and skipped tasks.
- Both `CorpusService` composition sites in `app.ts` (`:713`, `:1103`) wire both ports; `reviewService` is hoisted into a `const` at both App construction sites (`~:799`, `~:1171`) before the port is wired.
- Existing tests that pin the old behaviour are re-baselined. Approval: `tests/unit/service/tiered-review.test.ts:318`, `tests/unit/adapters/cli-adr-decision-status.bun.test.ts:242`, `tests/unit/service/gate-evaluation-trace.test.ts:297`, `tests/helpers/cli-live-rule.ts`, the gate-enforcer service-layer, gate-spec-promote, requires-uat-gate and gate-hooks tests, `tests/integration/archive-sweep-cli.bun.test.ts:261`, `tests/e2e/bootstrap-injection-compiled.bun.test.ts:346` — the full list is the output of the implement task's enumeration command. Cascade: `tests/integration/plan-close-cascade.bun.test.ts`, `tests/unit/service/plan-close-cascade-plan-membership.test.ts`, `tests/e2e/plan-close-invariants-compiled.bun.test.ts`.

## Out of scope

- `lore set <task> --status archived` without floors (BR-212, second half of #47's body) — filed as #174.
- Override flags on `set` (`--override-judgment`, `--override-no-judgment`): overrides stay on `lore approve` only; a refusal through `set` is the same refusal `approve` gives, which already names judging.
- The ledger fast-track re-approval inside `set()` (`corpus-service.ts:2976-3027`, SPEC-103 M1) is not a caller-requested transition and is unchanged.
- `spec-lifecycle-archival-plan-close-cascade-deterministic`: this spec SUPERSEDES its R1 clause "archive its child tasks that hold no fresh claim" and AC-097-2 for open tasks, and its D3 sentence "a second consecutive `--sweep` after `--apply` exits 0" for a floor-refused R4 task (it stays a reported candidate, D8). Its handoff half, its fresh-claim skip, its D2 no-rollback rule and R2/R3 are unchanged. The old spec is linked `relates-to`, not invalidated; locked AC-097-2 keeps its text while its oracle file is re-baselined (green only for attested tasks).

## Design Decisions

- **D1 — `set → approved` delegates to the approve path; it does not copy it.** `set()` calls `approvalPort.approve(id, opts)` and returns its result, so the verdict, the exit code, the refusal text, the version row (`action: "approve"`) and the audit row (`action: "approve"`) are the approve path's own. Rejected: refusing `set → approved` and pointing to `lore approve` (turns a status change that all four surfaces accept into a refusal for every caller, including the passing cases, while the dashboard already approves through its own `/approve` route — the refusal buys nothing the delegation does not, and costs every scripted `lore set --status approved`); copying the judgment check into `set` (a second copy of a gate drifts — the current defect is exactly a copy that ran one gate of three).
- **D2 — the approve path reaches `CorpusService` as a port injected from `app.ts`, never as a service import.** `packages/lore/src/service/CLAUDE.md` forbids cross-service imports; `CorpusService` gains `setApprovalPort(port)` in the same style as `setCiteGate` / `setRuleStateService`. At both App construction sites `reviewService` is hoisted into a `const` (today it is built inline in the returned object, `~:799` / `~:1171`) and then wired. The port's options carry `reviewer` (the resolved actor), `expectedVersion` (so HTTP/dashboard optimistic concurrency still yields STALE_VERSION → 409) and the write attribution `set()` received (`WriteActorOpts` from `resolveDocWriteOpts`), so the approve row is attributed exactly as the set row would have been; `ReviewService.approve` gains the matching `expectedVersion` / attribution options. The port type is declared structurally in `corpus-service.ts` (`DocRecord & { reachability_advisories?: string[] }`), with no import from `review-service.ts`. Rejected: importing `ReviewService` into `CorpusService` (violates the module rule; construction cycle); checking `expectedVersion` in `set()` before delegating (a check-then-write race the approve CAS would not close).
- **D3 — a bare `new CorpusService(store)` with no port keeps today's direct write.** Measured 2026-10-12: 39 test files (73 call sites) drive `set(... { status: "approved" })` on a bare service. This matches the existing convention for every optional collaborator (`gateEnforcer`, cite gate, rule state). Production cannot be unwired because AC-AP-7 asserts every composition site wires both ports and AC-AP-2 drives real surfaces over `createApp`. Rejected: making the port a required constructor argument (forces a no-op port into every test construction with no added protection over AC-AP-7's equality check).
- **D4 — `approved` plus another CHANGED field in one `set` call is refused (VALIDATION_ERROR, field `status`, exit 4) before any write.** A field is changed when its value differs from the stored value (deep equality for `extra`/`tags`); fields echoed with their stored value — e.g. an HTTP PATCH carrying the full document — are ignored and the call delegates as a pure approval. A real change makes a new version no judgment has seen, so an atomic edit-and-approve cannot pass the approve path; doing the edit then the approve would leave the edit committed when the approve is refused. The refusal names the two-step form (`lore set <doc> ...` then `lore approve <doc>`). Rejected: refusing whenever another key is present (refuses a full-document PATCH that changes nothing); applying the edit and then approving (half-written on refusal); approving the pre-edit version and then editing (records an approval of content that no longer exists).
- **D5 — one copy of the done floors, returned as data.** `TaskWorkflowService.checkDoneFloors(task)` returns `{ floor, error }` for the first failing floor (`attested-pass | red-first | no-new-tests | unfiltered-test-file`, in `_doneImpl`'s order) or `null`; `error` is the exact `LoreError` `lore done` returns today with `details.floor` added. `_doneImpl` calls it and returns that error unchanged, so `lore done` refusals stay byte-identical apart from the added detail. The `--override-attestation` branches (`task-workflow-service.ts:3355-3376`) stay in `_doneImpl` — an override is a `done` decision, never a cascade one. `CorpusService` reaches the method through `setDoneFloorPort(port)` injected in `app.ts` (same reasoning as D2). The check is not switched off by `workflow.gates."plan-close".enabled: false` (BR-214).
- **D6 — the plan-close cascade checks each task through the port and skips a failing task; it never refuses the close.** A port failure on one task is that task's `failed` entry, not a skip and not a rollback; the plan's own archival never rolls back. Rejected: print-only reporting (the task is still archived with no qualifying evidence); refusing to close a plan with open tasks (blocks abandoning a plan, which `lore set --status archived` exists to do).
- **D7 — human output.** After a plan → archived write, `lore set` prints `Cascade archived: <slug>` per archived task or handoff and `Cascade skipped: <slug> (<reason>)` per skipped task, where `<reason>` is the floor name or `fresh claim`; `--json` is unchanged except for the added `floor` field.
- **D8 — the sweep honours the same port.** `archiveSweepCandidate` checks an R4 task candidate through `DoneFloorPort` before writing; a failing task is not archived and its outcome is `{ ok: false, skipped: true, floor }`; `lore archive --apply` prints `[SKIPPED] <slug> — refused by <floor>` and `--json` carries `floor`. `lore archive --sweep` keeps reporting the task (exit 3) with the floor that would refuse it, so an unprovable straggler never goes silent; it leaves the report when it gains evidence, is finished, or is deprecated. R2/R3 (handoffs) are unaffected. Rejected: dropping floor-refused tasks from the sweep report (hides a task that never met its conditions); refusing the whole `--apply` (blocks unrelated handoff archival).

## Public Interface

```ts
// packages/lore/src/service/corpus-service.ts
export interface ApprovalPort {
  approve(id: string, opts: { reviewer: string; expectedVersion?: number } & WriteActorOpts):
    Promise<Result<DocRecord & { reachability_advisories?: string[] }, LoreError>>;
}
export type DoneFloor = "attested-pass" | "red-first" | "no-new-tests" | "unfiltered-test-file";
export interface DoneFloorPort {
  checkDoneFloors(taskId: DocId): Promise<Result<{ floor: DoneFloor; error: LoreError } | null, LoreError>>;
}
setApprovalPort(port: ApprovalPort): void;
setDoneFloorPort(port: DoneFloorPort): void;
// PlanCloseCascadeResult.skipped: ReadonlyArray<{ doc_id; slug; reason; floor?: DoneFloor }>
// archiveSweepCandidate(...) outcome gains { skipped?: true; floor?: DoneFloor }

// packages/lore/src/service/task-workflow-service.ts
checkDoneFloors(taskIdOrSlug: string): Promise<Result<{ floor: DoneFloor; error: LoreError } | null, LoreError>>;
// packages/lore/src/service/review-service.ts — ApproveOpts gains expectedVersion?: number and WriteActorOpts attribution
```

CLI: `lore set <plan> --status archived` adds `Cascade archived: <slug>` / `Cascade skipped: <slug> (<reason>)`; `lore archive --apply` adds `[SKIPPED] <slug> — refused by <floor>`.

## Edge cases

| Input | Result |
|---|---|
| `set <adr> --status approved`, no judgment | exit 4, same refusal as `lore approve <adr>`, no version, no audit row |
| `set <spec> --status approved`, approve judgment of current version, cites a live rule | exit 0; version and audit action `approve` |
| `set <spec> --status approved`, no criterion cites a live rule | exit 4, the same BR-1007 refusal `lore approve` gives |
| `set <plan> --status approved`, governing spec draft | exit 4 from `plan-promote`, same as `lore approve` |
| `set <prd> --status approved` (type not judged) | exit 0; recorded as `approve` |
| `set <spec> --status approved --title <new title>` | exit 4, VALIDATION_ERROR field `status`, nothing written |
| PATCH full doc (all fields equal to stored) + `status: approved` | delegates as a pure approval |
| PATCH `status: approved` with stale `expectedVersion` | 409 STALE_VERSION, nothing written |
| `set <doc> --status approved` on an already-approved doc | unchanged (no transition) |
| bare `new CorpusService(store)` (no port) | today's direct write (D3) |
| plan close, task with attested pass | archived, `archive-cascade` audit row |
| plan close, task with no evidence | stays open, skipped, `floor: "attested-pass"` |
| plan close, task with `red_first` and no expected-fail row | skipped, `floor: "red-first"` |
| plan close, freshly claimed task | skipped, reason fresh claim, no `floor` |
| plan close, `checkDoneFloors` returns err for one task | that task in `failed`; plan stays archived; others processed |
| plan close with `plan-close` gate disabled | floors still checked (BR-214) |
| `lore done` on a floor-failing task | same refusal as before, `details.floor` added |
| `archive --apply`, R4 task with no evidence | stays open, `[SKIPPED] ... attested-pass`; next `--sweep` still lists it (exit 3) |
| `archive --apply`, R4 task with attested pass | archived |

## Acceptance Criteria

Declared with `lore ac add` (AC-AP-1..10).


## Acceptance Criteria (structured)

- [⚑] [script] AC-AP-1: Service parity on a createApp-composed throwaway corpus (mkdtemp + SQLite, new file set-approval-gate-parity.bun.test.ts): for each case corpusService.set(doc,{status:'approved'}) is compared with reviewService.approve(doc) on an identical twin doc. (a) adr with no judgment: both return the same error code and message, version count and audit row count unchanged for both; (b) spec citing a live rule, no judgment: same as (a); (c) plan whose governing spec is draft: both refused by plan-promote with the same code; (d) spec citing a live rule with an approve judgment of its current version: set ok, the newest version row action === 'approve' and exactly one new audit row with action 'approve' and none with action 'update' for that write; (e) prd (type not judged): set ok, version action 'approve'; (f) set(spec,{status:'approved', title:<a different title>}) -> VALIDATION_ERROR field 'status', zero new version rows, zero new audit rows; (f2) set(spec,{status:'approved', title:<the stored title>, content:<the stored content>}) on a judged spec delegates as a pure approval (D4: echoed values are not a change) and succeeds with action 'approve'; (g) set on an already-approved doc with {status:'approved'} -> unchanged behaviour (no approve row); (h) spec whose criteria cite no live rule, with an approve judgment: set and approve both refused with the same BR-1007 / acceptance_criteria error code and field. The command requires exit 0 and bun's 'Ran N tests' with N >= 9. Smallest red mutation: removing the approvalPort call in set() makes (a) succeed and fails (a),(b),(d),(h).
  script: test — out=$(mktemp) && bunx --bun vitest run packages/lore/tests/integration/set-approval-gate-parity.bun.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 9 ] && echo 'AC-AP-1 PASS: set to approved gives the approve verdict in all 9 parity cases'
  other_command=4
- [⚑] [script] AC-AP-2: Surface drive over createApp on a mkdtemp corpus (file set-approval-gate-parity-surfaces.bun.test.ts). CLI (subprocess 'bun run src/index.ts' with cwd in the throwaway corpus): (d) lore set <adr> --status approved without a judgment exits exactly 4, its stderr equals lore approve <adr>'s stderr for the same doc, and lore log <adr> shows the same number of rows before and after. HTTP (real startHttpServer, bearer token): (e) PATCH /api/docs/<spec> with {status:'approved'} and a stale expectedVersion returns 409 with code STALE_VERSION and writes nothing; (f) the same PATCH with the current version after an approve judgment returns 200 and the approve audit row's actor is the token's actor. Service layer: (e2) set to approved with a stale expectedVersion is STALE_VERSION and writes nothing. The command requires exit 0 and 'Tests N passed' with N >= 4. Smallest red mutation: deleting the setApprovalPort call at the createApp composition site makes (d) succeed; dropping expectedVersion from the port options makes (e) return 200.
  script: test — out=$(mktemp) && bunx --bun vitest run packages/lore/tests/integration/set-approval-gate-parity-surfaces.bun.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 4 ] && echo 'AC-AP-2 PASS: CLI and HTTP set to approved each give the approve verdict, and a stale HTTP version is 409'
  other_command=5
- [⚑] [script] AC-AP-3: Re-baseline of the test that pinned the bypass: tiered-review.test.ts's makeApp wires the approval port to its ReviewService exactly as app.ts does, and the case at line 318 (REGRESSION: editing an approved spec still resets to draft) reaches approved through an approve judgment instead of an unjudged set; the whole file passes under vitest with exit 0 and 'Tests N passed' with N >= 1 (an all-skipped run prints no 'passed' count and fails), and the file contains 'setApprovalPort('. Smallest red mutation: leaving makeApp unwired fails the grep; wiring it without adding the judgment makes the line-318 case fail on its approve step.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 1 ] && grep -q 'setApprovalPort(' packages/lore/tests/unit/service/tiered-review.test.ts && echo 'AC-AP-3 PASS: tiered-review suite green with its makeApp wiring the approval port as app.ts does'
  other_command=1
- [⚑] [script] AC-AP-4: Cascade floors on a createApp-composed throwaway corpus (plan-close-cascade.bun.test.ts, re-baselined): a plan with members T1 (runner-attested pass), T2 (no evidence), T3 (red_first declared, attested pass, no expected-fail/fail row), T4 (fresh claim) and one plan-parented handoff H; set(plan,{status:'archived'}) returns ok and the plan is archived. (a) cascade.archived is exactly {T1, H}; (b) cascade.skipped is exactly {T2 floor 'attested-pass', T3 floor 'red-first', T4 with no floor and a fresh-claim reason}; (c) T2, T3, T4 keep their prior status; (d) exactly 2 archive-cascade audit rows are written; (e) with workflow.gates.plan-close.enabled false the same (a)-(d) hold; (f) parity: for T2 and T3, taskWorkflowService.done(task) is refused and the refusal's error.details.floor equals the floor the cascade recorded (asserted on the floor id, never on message text), and done writes nothing. The prior HAPPY case that archived an unattested task is rewritten to give that task an attested pass. The command requires exit 0 and 'Ran N tests' with N >= 6. Smallest red mutation: skipping the done-floor port call makes T2 and T3 archived and fails (a),(b).
  script: test — out=$(mktemp) && bunx --bun vitest run packages/lore/tests/integration/plan-close-cascade.bun.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 6 ] && echo 'AC-AP-4 PASS: plan close archives only floor-clearing tasks and names the refusing floor for the rest'
  other_command=4
- [⚑] [script] AC-AP-5: Port contract on InMemoryStore (plan-close-cascade-plan-membership.test.ts, re-baselined; bare CorpusService plus a stub DoneFloorPort): (a) membership is still by extra.plan_id - a member filed under another parent is checked and a non-member filed under the plan is neither checked nor archived (stub call log equals the member set exactly); (b) a stub returning {floor:'no-new-tests', error} for one member puts it in skipped with floor 'no-new-tests' and leaves it open; (c) a stub returning err for one member puts it in cascade.failed with that message, the plan stays archived and the other members are still processed; (d) a stub returning null archives the member. The command requires exit 0 and 'Tests N passed' with N >= 4. Smallest red mutation: treating a port err as a skip makes (c) fail.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/unit/service/plan-close-cascade-plan-membership.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 4 ] && echo 'AC-AP-5 PASS: cascade checks exactly the plan members through the port and maps floor, error and null correctly'
- [⚑] [script] AC-AP-6: Compiled CLI human output (plan-close-invariants-compiled.bun.test.ts, extended; mkdtemp + lore init): a plan with one attested task A and one task B with no evidence; lore set <plan> --status archived WITHOUT --json exits exactly 0, stdout has the line 'Cascade archived: <A slug>' and the line 'Cascade skipped: <B slug> (attested-pass)'; lore get <B> then shows B not archived; the same scenario with --json carries cascade.skipped[0].floor === 'attested-pass'. The command requires exit 0 and 'Ran N tests' with N >= 2. Smallest red mutation: removing the cascade lines from set.ts's human branch fails the stdout assertions while --json stays green.
  script: e2e — bun run build && out=$(mktemp) && bunx --bun vitest run packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 2 ] && echo 'AC-AP-6 PASS: compiled lore set prints Cascade archived and Cascade skipped lines and --json carries the floor'
  other_command=4
- [⚑] [script] AC-AP-7: Production wiring by equality, not containment: in packages/lore/src/app.ts the number of assignment-form 'new CorpusService(' constructions (measured 2 on 2026-10-12, at :713 and :1103) is >= 2 and EQUALS both the number of '.setApprovalPort(' calls and the number of '.setDoneFloorPort(' calls; and corpus-service.ts has no import from ./review-service.js or ./task-workflow-service.js (D2). Measured red 2026-10-12: n=2, a=0, d=0; green control (scratch copy with both calls at both sites) exits 0 with the PASS line. Smallest red mutation: deleting the setDoneFloorPort call at one composition site makes d=1 != 2 and the command exits 1.
  script: other — f=packages/lore/src/app.ts; n=$(grep -cE '=[[:space:]]*new CorpusService\(' $f); a=$(grep -c '\.setApprovalPort(' $f); d=$(grep -c '\.setDoneFloorPort(' $f); [ "$n" -ge 2 ] && [ "$a" -eq "$n" ] && [ "$d" -eq "$n" ] && ! grep -qE 'from "\./(review-service|task-workflow-service)\.js"' packages/lore/src/service/corpus-service.ts && echo "AC-AP-7 PASS: $n CorpusService composition sites in app.ts, each wiring setApprovalPort and setDoneFloorPort; corpus-service.ts imports neither review-service nor task-workflow-service"
- [⊘] [script] AC-AP-8: bun run typecheck exits 0 with ApprovalPort, DoneFloorPort, TaskWorkflowService.checkDoneFloors and the skipped[].floor field threaded through every package and script.
  script: tsc — bun run typecheck
  other_command=2
- [⚑] [script] AC-AP-9: Single copy of the done floors (new check-done-floors.test.ts; TaskWorkflowService on InMemoryStore): for one task per floor, (a) attested-pass, (b) red-first, (c) no-new-tests, (d) unfiltered-test-file, checkDoneFloors returns {floor, error} with error.details.floor === floor, and done() on the same task returns an error deep-equal to that error and writes nothing (version and audit counts unchanged); (e) a task meeting all floors gets null; (f) done with --override-attestation and a non-empty reason on an unattested task still archives with the audited reason (the override stays in _doneImpl, never reached through checkDoneFloors); (g) the floors are evaluated in _doneImpl's order: a task failing both attested-pass and red-first reports attested-pass. The command requires exit 0 and 'Tests N passed' with N >= 7. Smallest red mutation: done() re-deriving a floor message instead of returning checkDoneFloors' error makes the deep-equality in (a)-(d) fail.
  script: test — out=$(mktemp); bunx vitest run packages/lore/tests/unit/service/check-done-floors.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 7 ] && echo 'AC-AP-9 PASS: checkDoneFloors returns each floor with the exact done error, and done returns it unchanged'
- [⚑] [script] AC-AP-10: The sweep honours the floors (new archive-apply-done-floors.bun.test.ts; mkdtemp + lore init, CLI subprocess): an archived plan with an open unclaimed task T2 (no evidence), an open unclaimed task T1 (attested pass) and an expired R3 handoff. (a) lore archive --apply leaves T2 open and prints '[SKIPPED] <T2 slug> — refused by attested-pass'; (b) T1 is archived; (c) lore archive --apply --json carries floor 'attested-pass' on T2's outcome; (d) a following lore archive --sweep exits exactly 3 and lists T2 with the refusing floor (never silent); (e) the handoff is archived by the same --apply. The command requires exit 0 and 'Ran N tests' with N >= 5. Smallest red mutation: archiveSweepCandidate skipping the port call archives T2 and fails (a).
  script: test — out=$(mktemp) && bunx --bun vitest run packages/lore/tests/integration/archive-apply-done-floors.bun.test.ts > "$out" 2>&1; ec=$?; cat "$out"; n=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p' "$out"); [ "$ec" -eq 0 ] && [ "${n:-0}" -ge 5 ] && echo 'AC-AP-10 PASS: archive --apply leaves floor-refused straggler tasks open and keeps reporting them'
  other_command=4

## Code anchors

- packages/lore/src/service/corpus-service.ts#ApprovalPort
- packages/lore/src/service/corpus-service.ts#DoneFloorPort
- packages/lore/src/service/task-workflow-service.ts#DoneFloorRefusal
- packages/lore/src/adapters/http/routes.ts
- packages/lore/src/adapters/cli/commands/archive.ts
- packages/lore/src/adapters/cli/commands/set.ts
