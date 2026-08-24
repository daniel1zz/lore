---
id: SPEC-055
type: spec
role: spec
title: "Requirement→AC completeness oracle"
status: approved
priority: medium
created: 2026-07-18
updated: 2026-07-27
tags: []
parent: PRD-001
---
# SPEC-055 — Requirement→AC completeness oracle

## Overview/Goal

A PRD promises N user-facing things; downstream specs declare acceptance criteria that
implement some of them. Nothing detects the gap — the "spec-sampling illusion" at the
requirements level: a requirement a PRD makes can silently reach `active` with NO acceptance
criterion covering it. `prdExtraSchema` is `z.record(z.unknown())` today — requirements are
not even machine-enumerable.

This spec adds (1) a **structured PRD requirement inventory** (`prd.extra.requirements` — a
typed, numbered `R-##` array with priority, authored via `lore requirement add`, mirroring
`lore ac add`), (2) an **AC→requirement linkage** (an optional `requirement_refs: string[]`
on each acceptance criterion — the AC declares which requirements it covers, authored via
`lore ac add --covers R-1`), and (3) a **deterministic completeness oracle** —
`lore status --check-requirements` (zero-LLM, CI-runnable, composes with `--check-tree`/
`--check-drift`) that walks each PRD's requirements against every descendant spec's AC
`requirement_refs` and reports uncovered requirements, exiting 3 when any P0 requirement is
uncovered. Advisory/CI-report, NOT a write-blocking gate — completeness is a moving target
during development.

## Scope

**In scope:**
- `@lore/core/requirement.ts` — `REQUIREMENT_PRIORITIES` (P0/P1/P2), `requirementSchema`
  (`id` regex `^R-[A-Z0-9]+(-[A-Z0-9]+)*$`, `statement`, `priority`), `prdRequirementsSchema`
  (array, max 100, unique ids), and the pure `computeRequirementCoverage(requirements, refs)`
  + `requirementCoverageExitCode(coverage)`.
- `prdExtraSchema` gains typed `requirements` (was untyped `z.record`); `acceptanceCriterionSchema`
  gains optional `requirement_refs: string[]`.
- `RequirementService.addRequirement/listRequirements/removeRequirement` (mirrors `AcService`
  — CAS write on `prd.extra.requirements` + version bump + audit; the SOLE structured writer).
- `CorpusService.computeRequirementCoverageForPrd(prdIdOrSlug)` — resolves the PRD, gathers
  every descendant spec's ACs' `requirement_refs`, returns the coverage report.
- `lore status --check-requirements [--json]` — deterministic oracle; uncovered-P0 → exit 3,
  composes with the existing `--check-tree`/`--check-drift` exit-precedence machinery.
- CLI `lore requirement add <prd> <id> --statement --priority` / `lore requirement list <prd>`
  / `lore requirement rm <prd> <id> [--force]`; `lore ac add ... --covers <R-id>` (repeatable).
  MCP `lore_requirement_add`.

**Out of scope:**
- AI/semantic matching of requirement↔AC (this oracle is deterministic ref-based coverage; a
  semantic "does this AC actually satisfy this requirement" advisory is a later spec).
- Auto-extracting requirements from PRD prose (explicit `lore requirement add` only).
- A write-blocking requirement gate (the deterministic status check is the enforcement; a
  spec-promote requirement gate was explicitly deferred — requirement↔spec attribution is
  ambiguous and needs its own design).

## Acceptance Criteria

(Structured, script-mode, oracle-bound — added via `lore ac add`.)

- **AC-055-1** — `requirementSchema` parses a well-formed `{id:"R-1", statement, priority:"P0"}`
  and rejects one with an out-of-enum priority and one with a malformed id (no `R-` prefix);
  asserted by a test with ≥1 accept and ≥2 reject cases (exit 0).
- **AC-055-2** — `prdRequirementsSchema` rejects an array with two entries sharing an id
  (unique-id superRefine), and `acceptanceCriterionSchema` accepts an optional
  `requirement_refs: string[]` (absent still parses — REGRESSION); asserted by a test (exit 0).
- **AC-055-3** — `computeRequirementCoverage(requirements, refs)` returns empty `uncovered`
  when every requirement id appears in `refs`; returns a non-empty `uncovered_p0` when a P0
  requirement id appears in NO ref; returns all-empty for an empty `requirements` array
  (vacuous); asserted by a truth-table test (≥3 cases, exit 0).
- **AC-055-4** — `requirementCoverageExitCode(coverage)` returns `3` iff `uncovered_p0` is
  non-empty, else `0`; asserted by a both-branch test (exit 0).
- **AC-055-5** — `RequirementService.addRequirement` then `listRequirements` round-trips the
  requirement on `prd.extra.requirements` preserving any other `extra` keys; `removeRequirement`
  drops it; asserted by a store round-trip test (exit 0).
- **AC-055-6** — `CorpusService.computeRequirementCoverageForPrd` gathers a descendant spec's
  AC `requirement_refs` and reports a PRD requirement covered iff some descendant AC references
  it; a requirement referenced by NO descendant AC is reported uncovered; asserted by a
  multi-doc store test (exit 0).
- **AC-055-7** — `AcService.addCriterion` accepts and persists a `requirement_refs` value on the
  criterion (the `lore ac add --covers` linkage), round-tripped via `listCriteria`; a criterion
  with no `requirement_refs` still validates (REGRESSION); asserted by a test (exit 0).

## Design Decisions

- **D1 — deterministic status check, not a write gate.** Completeness is aspirational during
  active development; blocking every spec write on full requirement coverage would stall
  normal work. `lore status --check-requirements` (a CI-runnable report, exit 3 on uncovered
  P0) mirrors `--check-drift`'s "deterministic oracle you run when you want it" posture, and
  composes with it under the same pinned exit-precedence.
- **D2 — typed `prd.extra.requirements` + a sole-writer service.** Mirrors the AcService
  precedent exactly (typed array, `R-##` id grammar, CAS + audit, unique-id superRefine).
  `prdExtraSchema` becomes `z.object({requirements?}).passthrough()` — backward-compatible
  (every existing PRD with no requirements stays valid).
- **D3 — AC-side linkage (`requirement_refs`), not requirement-side.** An AC declaring which
  requirements it covers is the natural authoring moment (`lore ac add --covers`); the inverse
  (a requirement listing its ACs) would need updating on every AC add. Coverage is computed by
  gathering refs, never stored.
- **D4 — `computeRequirementCoverage` is pure and the single coverage read.** Both the CLI
  oracle and any future advisory surface consume it; `requirementCoverageExitCode` is the
  single exit-code derivation (mirrors drift's exit-precedence helper).

## Downstream Handoff

- **implement**: `@lore/core/requirement.ts` (schema + pure fns) + `prdExtraSchema`/
  `acceptanceCriterionSchema` changes (`schemas.ts`/`acceptance.ts`); `RequirementService`
  (`packages/lore/src/service/requirement-service.ts`); `CorpusService
  .computeRequirementCoverageForPrd`; `status.ts` `--check-requirements` branch (fold into the
  D5 exit-precedence); CLI `commands/requirement.ts` + `ac.ts` `--covers`; MCP
  `lore_requirement_add`.
- **test**: all 7 ACs are pure schema/coverage + service round-trip + multi-doc store
  assertions — NO live provider, NO CLI subprocess; failure-first (uncovered-P0 proven to
  surface + drive exit 3).


## Acceptance Criteria (structured)

- [⚑] [script] AC-055-1: requirementSchema parses a well-formed R-1 P0 requirement and rejects one with out-of-enum priority and one with a malformed id (no R- prefix); test >=1 accept and >=2 reject cases exit 0
  script: test — bunx vitest run packages/core/tests/unit/requirement.test.ts packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-055-2: prdRequirementsSchema rejects an array with two entries sharing an id and acceptanceCriterionSchema accepts an optional requirement_refs (absent still parses REGRESSION); test exit 0
  script: test — bunx vitest run packages/core/tests/unit/requirement.test.ts packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-055-3: computeRequirementCoverage returns empty uncovered when every requirement id appears in refs, non-empty uncovered_p0 when a P0 id appears in no ref, and all-empty for an empty requirements array; truth-table test >=3 cases exit 0
  script: test — bunx vitest run packages/core/tests/unit/requirement.test.ts packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-055-4: requirementCoverageExitCode returns 3 iff uncovered_p0 is non-empty else 0; both-branch test exit 0
  script: test — bunx vitest run packages/core/tests/unit/requirement.test.ts packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-055-5: RequirementService.addRequirement then listRequirements round-trips the requirement on prd.extra.requirements preserving other extra keys and removeRequirement drops it; store round-trip test exit 0
  script: test — bunx vitest run packages/core/tests/unit/requirement.test.ts packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-055-6: CorpusService.computeRequirementCoverageForPrd gathers a descendant spec AC requirement_refs and reports a PRD requirement covered iff some descendant AC references it, uncovered otherwise; multi-doc store test exit 0
  script: test — bunx vitest run packages/core/tests/unit/requirement.test.ts packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-055-7: AcService.addCriterion accepts and persists a requirement_refs value round-tripped via listCriteria and a criterion with no requirement_refs still validates REGRESSION; test exit 0
  script: test — bunx vitest run packages/core/tests/unit/requirement.test.ts packages/lore/tests/unit/service/requirement-service.test.ts
