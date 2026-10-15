---
id: PLAN-154
type: plan
role: plan
title: "Approval and plan closure go through the same checks on every surface"
status: archived
priority: high
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-172
phases:
  - {name: "approval-parity", description: "#65 + #50: set -> approved delegates to the approve path through an injected port"}
  - {name: "plan-close-floors", description: "#47: the plan-close cascade checks each task against lore done's floors and prints archived/skipped"}
  - {name: "verification", description: "on main after the last merge: build, verify every script AC, retire nothing further"}
  - {name: "archive-sweep-floors", description: "#173: lore archive --apply honours the same done-floor port"}
links:
  - {id: SPEC-172, type: implements}
---
# Plan — Approval and plan closure go through the same checks on every surface

Implements `spec-approval-and-plan-closure-go-through-the-same-checks-on` (AC-AP-1..10), baseline leaves `baseline-approve-a-document` (BR-1071) and `baseline-close-a-plan` (BR-1072). Issues #65, #50, #47, #173. Residual filed, not in this plan: #174 (`lore set <task> --status archived`).

## Overview

Four implement units, each preceded by a RED test unit, serialized on corpus-service.ts / app.ts:

1. **approval-parity** (#65 + #50, one implement task, one code path): `set()` delegates a requested transition to `approved` to an `ApprovalPort` bound in `app.ts` to `ReviewService.approve` (with `expectedVersion` and attribution); approve + another CHANGED field is refused; set-local spec-promote/BR-1007 blocks removed; 36 enumerated tests re-baselined.
2. **plan-close-floors (i)** (#47): `TaskWorkflowService.checkDoneFloors` extracted from `_doneImpl` (returns `{floor, error}`, `_doneImpl` returns the error unchanged), `DoneFloorPort` wired in `app.ts`.
3. **plan-close-floors (ii)** (#47): the cascade uses the port; `lore set` human output prints the cascade.
4. **archive-sweep-floors** (#173): `archiveSweepCandidate` / `lore archive --apply` use the same port.

Order: IMPL-1 → IMPL-2a → IMPL-2b → IMPL-3. Cross-plan: IMPL-2a blocks Plan B's capture-label implement task (both edit task-workflow-service.ts; that task's done-floor assertion for `runner-unattested` rows targets the extracted `checkDoneFloors`). Then a verification phase on main (full suites, leaf prose re-pointing).

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | `bun run typecheck` exits 0 after every merge | AC-AP-8; orchestrator re-run on main |
| I2 | No service imports another service; ports are injected from `app.ts` | AC-AP-7 (no `./review-service.js` / `./task-workflow-service.js` import in corpus-service.ts; port-call count equals composition-site count) |
| I3 | Every changed refusal names its exit code in its AC: set → approved refusals are the approve path's own (exit 4); approved + other field → VALIDATION_ERROR exit 4 | AC-AP-1 (f), AC-AP-2 |
| I4 | One copy of the done floors: `_doneImpl` calls `checkDoneFloors`; the cascade reaches the same method through the port | AC-AP-4 (f) parity case |
| I5 | No test writes the repository's live `.lore/` | mkdtemp + `lore init` / `createApp` on a temp path; InMemoryStore |
| I6 | A RED task commits its tests on its own branch; the paired implement task branches from that commit; nothing red merges to main | orchestrator merge order (RED branch merged together with its implement branch) |
| I7 | After the last merge: `bun run build` exits 0 and `lore verify` of this plan's script ACs passes on main | verification task |

## Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | 36 test files drive a composed App/CLI and set `approved` (enumeration command in IMPL-1); they turn red once the port is wired | M | IMPL-1 re-baselines each (judgment or `--override-no-judgment`), anchors the known ten; the verification task runs the FULL vitest and bun suites on main |
| R2 | A scripted caller relies on `set --status approved --content ...` in one call | M | D4 refusal names the two-step form; MCP/HTTP return the same VALIDATION_ERROR |
| R3 | A floor-refused R4 task keeps `lore archive --sweep` at exit 3 until it gains evidence or is deprecated | M | D8 deliberately (never silent); the sweep line names the floor and the repair |
| R4 | `_doneImpl` refactor changes a floor's order or message | M | AC-AP-4 (f) compares the cascade floor with done's refusal per task; existing done-floor tests stay in the scoped run |
| R5 | `ReviewService` is built after `CorpusService` in `app.ts`; wiring order | L | setter injection after both exist, same as `setRuleStateService` |

## Pre-registered branches

None.

## Decisions Log

- 2026-10-12 — user: #65 + #50 are one implement task; `set → approved` DELEGATES to the `ReviewService.approve` check path (judgment for `workflow.review.judgment_required_types`, spec-promote, plan-promote) and is audited as approve. Rejected: refuse `set → approved` and point to `lore approve`; copy the judgment check into `set`.
- 2026-10-12 — user: #47 cascade checks each member task against `lore done`'s floors; a failing task is not archived but listed in `skipped` with the refusing floor; human output prints archived and skipped lists. Rejected: print-only; refuse to close a plan with open tasks.
- 2026-10-12 — user: the spec supersedes R1 / AC-097-2 of `spec-lifecycle-archival-plan-close-cascade-deterministic` for open tasks only; linked `relates-to`, not invalidated.
- 2026-10-12 — corpus author: the port pattern (setter injection from `app.ts`) for both delegations, per the service module's no-cross-service-import rule (spec D2, D5).
- 2026-10-12 — corpus author: baseline rules added + defect rules retired (not rewritten in place), see spec Baseline line.
- 2026-10-12 — user (S3): #173 joins this plan — `lore archive --apply` honours the same done-floor port (spec D8, AC-AP-10).
- 2026-10-12 — S3 review: D4 narrowed — approve + other field is refused only when a field's value differs from stored; `ApprovalPort` carries `expectedVersion` and attribution; `checkDoneFloors` returns `{floor, error}` with the override branches left in `_doneImpl`; the plan-close work is split into 2a/2b so no task is larger than M.
