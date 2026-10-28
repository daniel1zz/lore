---
id: PLAN-162
type: plan
role: plan
title: "Run identity slice 1 — harness-attested runs"
status: archived
priority: medium
created: 2026-10-11
updated: 2026-10-25
tags: [identity, run]
parent: SPEC-165
phases:
  - {name: "P1 Contracts", description: "Core types and pure functions (run ids, claim-conflict predicate, rewrite), invocation identity resolver, store migration 016 + run store methods + write-context decorator. Everything later implements against these."}
  - {name: "P2 Runs and claims", description: "RunService + lore run register/show/attest-input; claim and release decided by run in both task and phase paths."}
  - {name: "P3 Write surfaces", description: "CLI entry resolves identity once and wraps the store; CorpusService claimed author (no 'system'); get/log/status rendering + attribution share; MCP harness_run + optional by."}
  - {name: "P4 Adapter and distribution", description: "run-register and pre-tool-harness-run hooks (blind pipes); registration in distribution-hooks, assets manifest, fresh-install probe step."}
  - {name: "P5 Integration and purge", description: "End-to-end hook to CLI to stamped write without a live session; removal of shipped identity-setting text (only after P4 distribution, invariant I6)."}
  - {name: "P6 Verification and close", description: "lore verify, full suites on main, build, rule confidence updates, BR-125 deprecation, code anchors, user fragment refresh, day-0 attribution share, handoff."}
links:
  - {id: SPEC-165, type: implements}
---
# Plan — Run identity slice 1

Implements `spec-run-identity-slice-1-harness-attested-runs-attested` (AC-RID-1..18). Decision record: `adr-run-identity-is-issued-by-lore-and-attested-by-the-harness` (U1–U5). Governance: batched (S1 done in the ADR; this plan is an S2 draft; S3 bundle review and S4 single approval follow).

## Overview

Each main session and subagent becomes a run registered by lore; every write is stamped with the harness-attested run at one store chokepoint and keeps any self-reported name as `claimed`; same-task claims and releases are decided by run in both the task and the phase paths; read surfaces show `attested · claimed`; shipped instructions to set identity are removed in the same slice.

## Invariants (checked at every phase gate)

| # | Invariant | How it is checked |
|---|---|---|
| I1 | `harness_run` on audit and version rows is written only by the store decorator from the invocation identity; the only other writer is the claim record (`extra.claim.harness_run`), filled from the same identity passed through claim/release opts; `--by` and `$LORE_ACTOR` never set it | AC-RID-5, AC-RID-6, AC-RID-12 |
| I2 | Both claim paths decide conflicts through the single core predicate | `grep -c hasClaimConflict packages/lore/src/service/task-workflow-service.ts packages/lore/src/service/phase-workflow-service.ts` → ≥1 in each |
| I3 | Hooks hold no rewrite grammar (spec D10) | `grep -c -- '--harness-run' assets/hooks/pre-tool-harness-run.mjs` → 0 |
| I4 | No test or smoke run writes the repository's live `.lore/` corpus | every new test uses `mkdtemp` + `lore init` (root CLAUDE.md rule) |
| I5 | After each merge wave on main: `bun run typecheck` exit 0, both runners green for the changed scope, `bun run build` exit 0 | orchestrator, unscoped and `--force` per the merge rules |
| I6 | The text purge (AC-RID-17) never lands before the adapter is installable AND writes are stamped (AC-RID-16) | `blocks` links CLI entry → distribution → purge |

## Risk register

| # | Risk | Impact | Trigger | Mitigation (task) | Contingency |
|---|---|---|---|---|---|
| R1 | Shell rewrite mangles a command | H | any AC-RID-15 table row fails, or a rewritten command errors in e2e | RED table test incl. idempotence, quotes, heredoc (core RED task) | hook falls back to passing the input through unchanged → unattested |
| R2 | SQLite / Turso / InMemory diverge | H | AC-RID-5 green on one store, red on another | matrix runs on SQLite and InMemory; Turso shares the SQL migration | block merge until parity |
| R3 | Text purge lands before the adapter (agents lose identity) | H | AC-RID-17 green while AC-RID-16 red | purge task blocked by distribution task (I6) | revert the purge commit |
| R4 | SubagentStart registration loses the race with the first tool call | M | e2e or rollout shows subagent writes with an unknown run id | AC-RID-18 e2e | pre-registered branch B2 |
| R5 | Stripping `--harness-run` at the CLI entry breaks argument parsing | M | any existing CLI integration test red after the entry change | entry task runs the full CLI integration scope | narrow the strip to the first token after `lore` |
| R6 | Per-call MCP decorator construction is slow | M | MCP call p95 grows > 20 ms vs baseline | measured in the MCP task | cache the decorated store per identity |
| R7 | Hot files edited by concurrent sessions (`task-workflow-service.ts`, `corpus-service.ts`) | M | merge conflict on landing | declared anchors; small diffs; rebase before evidence | conflict-resolution subagent |
| R8 | CLAM and DSIS leaves stay draft (rules were added) | L | leaves still draft at plan close | re-approved in the S4 batch | — |

**[RISK_REGISTER]** 8 risks: 3H / 4M / 1L — every H risk has a mitigation task.

## Pre-registered branches (approved at S4, executed without asking)

| # | Trigger (measurable) | Path |
|---|---|---|
| B1 (U2) | Attribution share < 80% over the first 14 days after rollout | find the bypassing call shapes from the unattested audit rows; widen the hook's matching; writes stay unattested meanwhile, never refused |
| B2 | > 5% of subagent writes in the e2e run or the first 14 days carry an unregistered run id | make `lore run attest-input` register the run on a miss (lazy registration) instead of relying on SubagentStart ordering |

## Decisions log

| Decision | Chosen | Rejected (why) |
|---|---|---|
| Decomposition strategy | **Interface-first**: contracts (core types + pure functions + store) → parallel behaviour tasks with disjoint anchors → adapter and distribution → integration and purge → verification | Vertical slices per backbone step (every slice touches the store and core types → serial chain); Risk-first spike (the risky unknowns — hook payloads, updatedInput — were already measured in the validation ledger) |
| Test authorship | Each implement task is preceded by a RED test task written by a separate agent (complexity ≥ medium rule) | Tests inside the implement task |
| Library research | No new dependency: zod (existing) for the run record schema; `node:crypto` sha256 for fragment hashes; the existing `ignore`/fragments code for selection | Adding a shell-parsing library for the rewrite (the rewrite only needs command-position detection and quote skipping; a parser adds a dependency to core, which must stay browser-safe) |
| Module design | spec D1–D10 | see spec |

## Estimation summary and critical path

Session-units: S=1, M=2, L=3. 23 tasks.

| Phase | Tasks | Units |
|---|---|---|
| P1 Contracts | core RED S, core module M, resolver RED S, resolver S, store RED S, store L | 9 |
| P2 Runs and claims | run RED M, RunService M, claim RED M, claim M | 8 |
| P3 Write surfaces | matrix RED M, CLI entry L, render RED S, render M, MCP RED S, MCP M | 11 |
| P4 Adapter and distribution | hooks RED S, hooks S, probe RED S, distribution S | 4 |
| P5 Integration and purge | e2e M, purge M | 4 |
| P6 Verification and close | verify M | 2 |

**[ESTIMATION]** Total 38 session-units — ⚠ above the 10-unit "consider splitting" line; kept as one plan because every phase depends on P1's contracts and the slice must land together (ADR decision 7, invariant I6). Parallelism: 10 RED tasks start at once; P2/P3 implement tasks run in parallel on disjoint anchors.

**[CRITICAL_PATH]** 17 session-units — ⚠ above the 6-unit line: `task-skill-test-red-core-run-identity-pure-functions-rewrite` → `task-skill-implement-core-run-identity-module-types-harness` → `task-skill-implement-store-migration-016-run-store-methods` → `task-skill-implement-runservice-lore-run-register-show-attest` → `task-skill-implement-cli-entry-resolves-identity-once-and-wraps` → `task-skill-implement-claim-and-release-by-run-in` → `task-skill-implement-mcp-harness-run-argument-optional-by-per` → `task-skill-verify-verify-every-ac-close-the-baseline-loop`. The claim task now waits for the CLI entry (S3 finding: its tests are CLI integration tests), which added 2 units. Slack: core/node resolver, rendering, hooks, distribution, e2e, purge.

**[COVERAGE]** spec ACs covered 18/18 by task ac_scope; orphan tasks 0.
**[STRUCTURE]** `lore ready --json` 2026-10-11 (after S3 fixes, 38 blocks links): 23 records, 10 ready (all RED tasks), anchor_conflicts 0, no cycle, 25 unresolved anchors all `file_missing` (files this plan creates), all `upstream_unapproved` until the S4 approval.

## S3 bundle review

Round 1 (three lenses over the whole bundle): cross-document + design NEEDS_WORK (5 MAJOR, 4 MINOR), plan task audit NEEDS_WORK (3 MAJOR, 6 MINOR), rules + AC falsifiability NEEDS_WORK (2 large, 12 others). All applied in one edit pass on 2026-10-11: rules BR-1029/1032/1035/1037/1040/1042/1043 rewritten; leaf note 'Superseded on landing' (BR-125 → claim task, BR-135 → purge task); ADR wording note and U1 residual risks; spec D6 legacy marker, D11 name tiers kept, WriteContext public; 14 ACs strengthened (AC-RID-17 with negative controls, AC-RID-16 requires the probe step's PASS line, AC-RID-11 mixed seed); 4 blocks links added; task bodies use slugs, explicit commands, Integration lines.

## Exit criteria

- Every AC-RID-1..18 has an attested pass via `lore verify`.
- I1–I6 hold on main; `lore status --check-drift` exit 0 after code anchors are declared.
- BR-1027..BR-1045 moved from unconfirmed to established where a citing criterion now passes; BR-125 deprecated by the claim task and BR-135 by the purge task (leaf 'Superseded on landing').
- `lore assess` run once at the end of the initiative.
- Handoff written with the attribution-share baseline measured on day 0.
