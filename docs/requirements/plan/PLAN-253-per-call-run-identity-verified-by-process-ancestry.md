---
id: PLAN-253
type: plan
role: plan
title: "Plan: per-call run identity verified by process ancestry (#418)"
status: approved
priority: critical
created: 2026-10-26
updated: 2026-10-27
tags: [governance-mechanism-fixes, issue-418]
parent: SPEC-245
phases:
  - {name: "P1 Red", description: "Failing tests for AC-RV-1, 3, 4, 5, 6"}
  - {name: "P2 Carrier and verification", description: "prefixRunExport and attest path, transform deleted; verifyRunAncestry, flag retired, refusal causes; one integrate"}
  - {name: "P3 Callers", description: "Tool-server verification, pre-edit-anchor-gate hook, test helpers and the 30 files passing --harness-run"}
  - {name: "P4 End to end and distribution", description: "Compiled e2e shell forms and concurrency, fresh install, shipped text"}
  - {name: "P5 Close", description: "lore verify, rule apply, code anchors, fresh consumer install check"}
---
# Plan — per-call run identity verified by process ancestry (#418)

Implements `spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and` (AC-RV-1..12; per-session verification per user decision D19; #457 joined per D20). Decision record: `adr-a-bash-call-s-run-identity-travels-in-a-per-call` (D14). Rules: BR-1424 (proposed), BR-1055, BR-1218, BR-1351 (modified). Issues: #418 (carried by this plan), #457 (carried by its task). Governance: batched S2 draft.

## Ordering in the initiative

This is the second plan. Ordering is written as task-level links, because plan-level links are ignored by readiness (#464). Plan 356's close task blocks this plan's red task (its landing predicate is what lets chained tasks land). This plan's close task blocks the first tasks of the #414 and #420 plans, plus plan-evaluation-1's test-runs and origin tasks (they share commands/run.ts and tests/helpers/test-run-identity.ts, and origin depends on run resolution).

⛔ Its own implementers still write through today's text rewriter: until the P2 carrier and verification land, they call `lore` only in plain command position (no `./dist/lore`, no loops or functions). P2 and P3 land as ONE unit through the plan's declared integration branch `integration/run-identity-418` (`lore plan integration-branch`, 2026-10-26). Blocks edges between tasks count as met once the blocker is on that branch, so each chained task branches from it. Only the integration branch is passed to `lore integrate`, once. Each task's landing is then derived from git facts by plan 356's predicate (its tip is reachable from main), so chained tasks need no per-branch landing record. Landing earlier would break main: a binary that verifies without the export refuses every agent write, and the retired flag breaks the pre-edit hook, the three production child spawns and 30 test/script files until they move.

## Overview

The hook prefixes each Bash call with `export LORE_HARNESS_RUN='<run>'`. The binary verifies the run by walking from itself up its process ancestry to the run's registered harness process (pid and start time). `--harness-run` and the text rewriter are deleted. Refusals name their cause.

## Invariants

| # | Invariant | Checked by |
|---|---|---|
| I1 | No write is attributed to a run whose harness process is not an ancestor | AC-RV-3, AC-RV-6 |
| I2 | No text rewriting on the word `lore` remains | AC-RV-4 residual grep |
| I3 | Each concurrent call carries its own run | AC-RV-7 |
| I4 | The shipped hook, as installed fresh, injects the value | AC-RV-8 |
| I5 | P2 and P3 land together (one integrate) | the integration branch; one lore integrate of it |

## Phases

- **P1 Red**: failing tests for AC-RV-1, 3, 4, 5, 6 (unit and integration).
- **P2 Carrier and verification**: `prefixRunExport` and the attest path, deleting the transform; `verifyRunAncestry`, the process-table port extension, flag retirement, refusal causes.
- **P3 Callers**: the three production child spawns; `pre-edit-anchor-gate.mjs`; the test helpers and the 30 test/script files that pass `--harness-run`; claims of ended runs (#457).
- **P4 End to end and distribution**: the single setup allow rule; compiled e2e for shell forms and concurrency; fresh install; shipped text.
- **P5 Close**: `lore verify`, the live-session permission check (AC-RV-12, `lore uat record`), `lore rule apply`, code anchors, and a fresh-consumer-install check of the hook.

## Decisions log

- D1-D6: see the spec's Design Decisions; D14 (carrier) is the user's.
- The P2 carrier task and the P2 verification task are separate units (different files), but are integrated as one branch: the verification task branches from the carrier task's branch (I5).
- Test-helper migration is its own task: 30 files share no anchor with the implementation, and splitting avoids a 40-file task.
- 2026-10-27 (adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only, decision 7): the tool-server half is dropped. Task task-tool-server-verifies-harness-run-by-process-ancestry is invalidated, and its unlanded commits (the call-scope.ts ancestry check) on branch integration/run-identity-418 are dropped when that branch integrates, because call-scope.ts is deleted with the tool server.
- 2026-10-27: checked with `lore rule changes spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and`: the pending BR-1351 modification names no tool-server surface, so it needs no edit.
