---
id: SPEC-069
type: spec
role: spec
title: "SPEC-069 — Execution-time attestation floor + ad-hoc task channel"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: PRD-001
links:
  - {id: SPEC-039, type: relates-to}
  - {id: SPEC-058, type: relates-to}
  - {id: SPEC-054, type: relates-to}
---
# SPEC-069 — Execution-time attestation floor + ad-hoc task channel

## Overview/Goal

Two verified workflow-gate gaps (guyin 2026-07-22, verified against HEAD e9e5188):

1. **P2-8**: a full plan closed with 16/16 tasks carrying only self-reported
   `--result pass` evidence — `attested_evidence_ratio = 0.00` — and `lore verify`
   never ran because no AC was script-mode. SPEC-058's `oracleCoverage` is a
   PLAN-TIME predicate on spec-promote (declared ACs must cover required oracle
   kinds); nothing bridges declaration to EXECUTION: no gate consumes
   `attested_evidence_ratio` (computed in `assessment.ts:784`, judge-facts only).
   One fabricated or mistaken self-report is undetectable.
2. **P2-9**: ad-hoc bugs discovered mid-plan have no legitimate lightweight task
   channel — `taskExtraSchema.plan_id` and `parent_id` are unconditionally
   required — so the least-resistance path is parking unrelated tasks on whatever
   plan is open, which `lore assess` then correctly flags as scope drift. The
   workflow punishes the honest shape it gives no way to express.

Goal: close the declaration→execution attestation gap with a plan-close gate, and
give ad-hoc work a first-class home so scope drift stops being the default.

## Scope

- IN: a `plan-close` checkpoint predicate enforcing an attestation floor over the
  plan's tasks; config knob for the floor; `lore create task --adhoc` (planless
  task) + `--linkage "<why this plan>"` (justified attachment); `lore ready`/
  `lore tree`/`lore assess` handling of both; gate feeding pack for the new denial.
- OUT: auto-generating script ACs; retrofitting attestation onto archived plans;
  changing SPEC-058 plan-time `oracleCoverage` (complementary, stays); daemon-side
  enforcement (gates remain write-time, computed read-side).

## Design

**D1 — attestation floor at plan-close (opt-out, not opt-in).** New predicate
`attestationFloor` on the existing `plan-close` checkpoint (SPEC-054's home):
every task of the closing plan that carries ANY verification evidence must carry
≥1 runner-issued (attested) entry, and the plan-wide `attested_evidence_ratio`
must be ≥ `workflow.attestation.min_ratio` (default 0.5). Deny renders the SPEC-049
feeding pack naming each offending task and the literal repair command
(`lore verify <plan>` / `lore ac add <spec> <id> --mode script ...`). Escape
hatch mirrors existing gates: `workflow.gates.plan-close.enabled: false` or
per-plan `extra.attestation_exempt: true` with a required reason string —
exemption is visible in `lore assess` facts either way.

**D2 — ad-hoc tasks are first-class.** `lore create task --adhoc` sets
`extra.adhoc = true` and relaxes BOTH `plan_id` and `parent_id` (Zod superRefine
branches on the flag); the task parents to the root PRD for tree reachability.
`lore ready` gains an `--adhoc` listing (planless tasks are never "ready" under a
plan and must not be invisible). Mutually exclusive with `--plan-id`/`--phase`.

**D3 — justified attachment.** `lore create task --linkage "<why this plan>"`
stores `extra.linkage`; `lore assess` includes it in scope-fidelity facts so an
explained attachment is distinguishable from silent drift. `--adhoc` and
`--linkage` are mutually exclusive (one says "no plan", the other justifies the
plan chosen).

**D4 — single-pass validation.** Both new flags participate in the SPEC-065
single-pass create-task validation (missing/conflicting flags reported together).

## Acceptance Criteria

- AC-069-1: closing a plan (`active → archived`) whose tasks carry evidence but
  zero attested entries is DENIED at the plan-close checkpoint; the denial message
  names ≥1 offending task and contains the string `lore verify`.
- AC-069-2: after `lore verify` records attested evidence meeting the floor, the
  same transition SUCCEEDS.
- AC-069-3: `workflow.attestation.min_ratio` is honored: a corpus fixture at ratio
  0.4 fails the default 0.5 floor and passes with the knob set to 0.3.
- AC-069-4: a plan with `extra.attestation_exempt: true` + reason closes without
  attested evidence, and `lore assess` facts for it surface the exemption.
- AC-069-5: `lore create task --adhoc --title t` succeeds with no `--plan-id`/
  `--parent`; the doc has `extra.adhoc == true` and parents to the root PRD;
  `lore create task --adhoc --plan-id X` exits 2 (mutual exclusion).
- AC-069-6: `lore create task --plan-id X --linkage "found while testing X"`
  stores `extra.linkage` verbatim; assess facts for the plan include it.
- AC-069-7: `lore ready <plan> --json` output is unchanged for plan tasks
  (regression) and `lore ready --adhoc --json` lists open ad-hoc tasks.


## Acceptance Criteria (structured)

- [✔] [script] AC-069-1: Closing a plan whose tasks carry evidence but zero attested entries is DENIED at plan-close; the denial names an offending task and contains the string lore verify
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t "AC-069-1"
- [✔] [script] AC-069-2: After attested evidence meets the floor the same plan-close transition succeeds
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t "AC-069-2"
- [✔] [script] AC-069-3: workflow.attestation.min_ratio is honored: ratio 0.4 fails the default 0.5 floor and passes when the knob is set to 0.3
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t "AC-069-3"
- [✔] [script] AC-069-4: A plan with extra.attestation_exempt true plus reason closes without attested evidence and assess facts surface the exemption
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t "AC-069-4"
- [✔] [script] AC-069-5: create task --adhoc succeeds with no plan-id or parent, sets extra.adhoc true, parents to the root PRD; combining --adhoc with --plan-id exits 2
  script: test — bunx vitest run packages/lore/tests/unit/service/adhoc-task.test.ts -t "AC-069-5"
- [✔] [script] AC-069-6: create task --linkage stores extra.linkage verbatim and assess facts for the plan include it
  script: test — bunx vitest run packages/lore/tests/unit/service/adhoc-task.test.ts -t "AC-069-6"
- [✔] [script] AC-069-7: lore ready plan output is regression-unchanged for plan tasks and lore ready --adhoc --json lists open ad-hoc tasks
  script: test — bunx vitest run packages/lore/tests/unit/service/adhoc-task.test.ts -t "AC-069-7"
