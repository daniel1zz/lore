---
id: SPEC-069
type: spec
role: spec
title: "Execution-time attestation floor + ad-hoc task channel"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-08-01
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
- [·] [script] AC-069-8: lore plan exempt-attestation <plan> --reason <text> --kind <k> authors all three fields by READ-MERGE-WRITE onto extra (attestation_exempt true, attestation_exempt_reason, attestation_exempt_kind), leaving every unrelated extra key byte-identical — never the wholesale extra replacement lore set performs
  script: test — bunx vitest run packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts -t 'AC-069-8'
- [·] [script] AC-069-9: Refusals: a missing or whitespace-only --reason exits 2, and a --kind outside attestationExemptKindSchema's four values (red-tdd|no-oracle|pipeline-unreachable|other) exits 2 naming the permitted set — an exemption with no justification is never authorable
  script: test — bunx vitest run packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts -t 'AC-069-9'
- [·] [script] AC-069-10: The exemption is AUDITED: the write emits an audit entry carrying actor and reason, resolved by the same --by > LORE_ACTOR > OS-username precedence every other writer uses
  script: test — bunx vitest run packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts -t 'AC-069-10'
- [·] [script] AC-069-11: NO BACK DOOR: lore set --attestation-exempt exits 2 as an unknown flag, matching the dedicated-writer discipline lore outline exempt already establishes for prd_sync_exempt
  script: test — bunx vitest run packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts -t 'AC-069-11'
- [·] [script] AC-069-12: WRITER-EXISTS CLASS AUDIT: a source scan enumerates every plan-level extra.* field the plan-close checkpoint reads and asserts each has an authoring surface in packages/lore/src/adapters — the class this task's finding is one instance of, mechanized so the next gate-read field without a writer fails a test instead of an incident
  script: test — bunx vitest run packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts -t 'AC-069-12'
- [·] [script] AC-069-13: From a throwaway corpus driven by compiled dist/lore, THE PAIR: a plan denied by the attestation floor closes WITH the exemption and the close output NAMES the exemption and its reason; the identical plan WITHOUT it is still denied — so the exemption is provably what changed the verdict, and an exemption that allowed a close is never invisible
  script: e2e — cd packages/lore && bun test tests/e2e/plan-exempt-attestation-compiled.bun.test.ts
- [·] [script] AC-069-14: NO ORPHAN CASES: the whole plan-exempt-attestation suite passes as a single unfiltered file run, so the three formatAttestationExemptionNotice renderer cases that no tagged AC selects (HAPPY/NEGATIVE/BOUNDARY on the notice's activeness rule) are still exercised by a declared AC — 8+11+5+4+12 tagged = 40 of 43
  script: test — bunx vitest run packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts
- [·] [script] AC-069-15: verifyAdhocTask records ac_ref on its runner-attested evidence: the entry written for each executed script criterion carries ac_ref equal to that criterion id, cross-validated through the ad-hoc governing-AC port (resolveAdhocGoverningAcIds) rather than the plan-only parent_id walk
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts -t "AC-069-15"
- [·] [script] AC-069-16: Flipping recordAcRef for the ad-hoc channel opens no bypass: an ad-hoc attested write whose criterion id is not declared by the resolved governing spec is still refused, and the plan-owned verifyPlan path remains regression-identical in the ac_ref it stamps
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-runner-service.test.ts -t "AC-069-16"
