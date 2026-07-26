---
id: SPEC-054
type: spec
role: spec
title: "SPEC-054 — UAT-verdict-as-plan-close-gate"
status: approved
priority: medium
created: 2026-07-18
updated: 2026-07-18
tags: []
parent: PRD-001
---
# SPEC-054 — UAT-verdict-as-plan-close-gate

## Overview/Goal

User acceptance testing (`lore-uat`) is the strongest rigor in the workflow — a real user
accepting the product end-to-end against the design — yet its result is the LEAST mechanized:
PERSIST currently writes a free-text `knowledge --sub-type retro` doc that nothing reads. A
plan whose product FAILED P0 acceptance can still be closed (archived) with no signal.

This spec closes that gap in two halves: (1) a machine-readable **structured UAT verdict**
(`knowledge` sub_type `"uat"` with a typed `extra.uat` payload — tier-scoped accept/reject,
requirement coverage, UIUX bar), written by a dedicated `lore uat record` verb (the sole
writer, mirroring `lore handoff`'s writer-identity guard); and (2) a fifth deterministic
checkpoint gate `plan-close` that, for a plan that OPTS IN via `extra.requires_uat: true`,
BLOCKS the plan's close transition (→ `archived`) unless a linked UAT verdict shows P0
acceptance. Opt-out plans (no `requires_uat`) archive exactly as today — non-breaking.

## Scope

**In scope:**
- `@lore/core/uat.ts` — `uatVerdictSchema` (typed `extra.uat`) + the pure gate predicate
  `isP0Accepted(uat)`; `knowledgeExtraSchema.sub_type` gains `"uat"` with a superRefine
  requiring a Zod-valid `extra.uat` when `sub_type === "uat"` (mirrors the `assessment`
  branch).
- `UatService.record(planIdOrSlug, payload, {by})` — the SOLE writer of sub_type `"uat"`:
  creates the knowledge doc + an `informs` link to the plan. Direct `CorpusService.create`
  with `sub_type: "uat"` is rejected by the existing writer-identity guard (naming
  `lore uat record`, mirroring the `handoff` guard).
- A fifth checkpoint `plan-close` in `checkpoint-registry.ts` (predicate `uatP0Accepted`),
  wired through `GateEnforcer` into `CorpusService.set` on a plan's `→ archived` transition.
  Evaluated ONLY when the plan declares `extra.requires_uat: true` (absent → vacuous pass).
  Blocked verdict's feeding pack names the recovery (`lore uat record` / `/lore-uat` + the
  uncovered/rejected P0 items). Config `workflow.gates."plan-close".enabled` (default true).
- CLI `lore uat record <plan> --json-file <path> [--by]` (sole writer) + `lore uat show
  <plan> [--json]` (latest linked verdict). MCP `lore_uat_record`.
- `lore-uat` SKILL.md PERSIST step rewritten: `lore uat record <plan> --json-file` replaces
  the free-text `lore create knowledge --sub-type retro`.

**Out of scope:**
- Running an actual UAT session (that is `lore-uat`'s job; this spec only mechanizes the
  verdict + gate).
- Auto-deriving `requires_uat` from a spec's declared journeys (a later refinement; this
  spec uses an explicit plan opt-in).
- UAT-verdict calibration / staleness (the typed field makes it possible; not built here).
- Retrofitting the gate onto `lore assess` or a new `lore close` verb — the close transition
  IS plan → archived (the lifecycle terminal state).

## Acceptance Criteria

(Structured, script-mode, oracle-bound — added via `lore ac add`.)

- **AC-054-1** — `isP0Accepted(uat)` returns `true` for a clean accept and `false` for EACH
  of: `verdict: "reject"`; ≥1 P0 tier row with `rejected > 0`; non-empty
  `requirement_coverage.uncovered_p0`; `uiux.blocker_count > 0`; asserted by a truth-table
  test with ≥5 cases (exit 0).
- **AC-054-2** — `uatVerdictSchema` parses a well-formed payload and rejects one with an
  out-of-enum `verdict` and one missing `tier_results`; asserted by a test with ≥1 accept and
  ≥2 reject cases (exit 0).
- **AC-054-3** — `knowledgeExtraSchema` fails to parse `{sub_type: "uat"}` with no `extra.uat`
  payload, and still parses a non-uat `sub_type` with no `uat` field (REGRESSION); asserted by
  a test covering both branches (exit 0).
- **AC-054-4** — `UatService.record` creates exactly one `knowledge` doc with
  `extra.sub_type === "uat"` carrying the payload AND an `informs` link from that doc to the
  target plan; asserted by a store round-trip test (exit 0).
- **AC-054-5** — a direct `CorpusService.create({type: "knowledge", extra: {sub_type: "uat",
  ...}})` returns `err(VALIDATION_ERROR)` whose message names `lore uat record`; asserted by a
  test (exit 0).
- **AC-054-6** — the `plan-close` gate through `GateEnforcer`: a plan with
  `extra.requires_uat: true` and NO P0-accepting linked UAT verdict → `CorpusService.set`
  transitioning it to `archived` returns `err(VALIDATION_ERROR)` (`field: "gate:plan-close"`);
  the SAME plan with a P0-accepting linked verdict → the transition succeeds; a plan WITHOUT
  `requires_uat` → the transition succeeds (vacuous pass); asserted by a 3-branch test
  (exit 0).
- **AC-054-7** — the blocked `plan-close` feeding pack text names the literal `lore uat record`
  recovery command; asserted by a substring test on the error message (exit 0).
- **AC-054-8** — `UatService.record` then reading the plan's linked UAT verdicts back returns
  the persisted payload byte-equal to what was written (round-trip fidelity); asserted by a
  test (exit 0).

## Design Decisions

- **D1 — `knowledge` sub_type "uat", not a new doc type.** Mirrors the `assessment` sub_type
  precedent exactly (typed `extra`, sole-writer service, superRefine) — zero new DocType enum
  / parent-contract / tree / migration surface for a verdict that is fundamentally a
  knowledge artifact linked to a plan.
- **D2 — opt-in via `plan.extra.requires_uat`.** The gate is UNCONDITIONALLY registered but
  VACUOUSLY passes a plan that does not declare `requires_uat: true` (same "no upstream ⇒
  vacuous pass" shape as `task-claim`'s spec-presence guard) — so existing plans archive
  unchanged; only a plan that explicitly demands acceptance is gated.
- **D3 — close == plan → archived.** Lore has no separate "plan complete" state; `archived`
  is the lifecycle terminal. The gate fires on that transition in `CorpusService.set`, the
  same write path SPEC-052 already gates for spec-promote — the 5th gated call site.
- **D4 — `isP0Accepted` is pure and the SINGLE gate read.** verdict≠"reject" AND no P0 tier
  `rejected` AND empty `uncovered_p0` AND no UIUX blocker. Both the gate predicate and any
  future advisory surface read this one function — never a re-derivation.
- **D5 — sole-writer guard, mirroring handoff.** `extra.uat` is service-owned; direct
  `lore create knowledge --sub-type uat` is rejected loud (naming `lore uat record`), so the
  typed payload can never be hand-forged past its schema.

## Downstream Handoff

- **implement**: `@lore/core/uat.ts` (schema + predicate) + `knowledgeExtraSchema` branch
  (`schemas.ts`); `UatService` (`packages/lore/src/service/uat-service.ts`); `plan-close`
  checkpoint (`checkpoint-registry.ts`) + `GateEnforcer` wiring in `CorpusService.set`;
  writer-identity guard branch in `CorpusService._createImpl`; CLI `commands/uat.ts` +
  `uat-input.ts` (vitest-safe parse split, mirrors `handoff-input.ts`); MCP `lore_uat_record`;
  `lore-uat` SKILL.md PERSIST rewrite.
- **test**: all 8 ACs are pure schema/predicate + service round-trip + gate-branch assertions
  over `InMemoryStore` — NO live provider, NO CLI subprocess; failure-first (each gate branch
  proven to block/allow as specified).


## Acceptance Criteria (structured)

- [✔] [script] AC-054-1: isP0Accepted returns true for a clean accept and false for each of verdict reject, a P0 tier row with rejected>0, non-empty uncovered_p0, uiux blocker_count>0; truth-table test >=5 cases exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
- [✔] [script] AC-054-2: uatVerdictSchema parses a well-formed payload and rejects one with out-of-enum verdict and one missing tier_results; test >=1 accept and >=2 reject cases exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
- [✔] [script] AC-054-3: knowledgeExtraSchema fails to parse sub_type uat with no extra.uat and still parses a non-uat sub_type with no uat field REGRESSION; test both branches exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
- [✔] [script] AC-054-4: UatService.record creates exactly one knowledge doc with extra.sub_type uat carrying the payload AND an informs link from that doc to the plan; store round-trip test exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
- [✔] [script] AC-054-5: a direct CorpusService.create with type knowledge sub_type uat returns VALIDATION_ERROR whose message names lore uat record; test exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
- [✔] [script] AC-054-6: the plan-close gate via GateEnforcer blocks a plan with requires_uat true and no P0-accepting linked UAT verdict on set to archived (field gate plan-close), allows it with a P0-accepting verdict, and vacuous-passes a plan without requires_uat; 3-branch test exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
- [✔] [script] AC-054-7: the blocked plan-close feeding pack text names the literal lore uat record recovery command; substring test on the error message exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
- [✔] [script] AC-054-8: UatService.record then reading the plan linked UAT verdicts back returns the persisted payload equal to what was written round-trip fidelity; test exit 0
  script: test — bunx vitest run packages/core/tests/unit/uat.test.ts packages/lore/tests/unit/service/uat-service.test.ts
