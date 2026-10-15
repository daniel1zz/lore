---
id: SPEC-059
type: spec
role: spec
title: "Requirement-layer quantifiability lint (close SPEC-052 upstream blind spot)"
status: approved
priority: medium
created: 2026-07-20
updated: 2026-10-10
tags: []
---
# SPEC-059 — Requirement-layer quantifiability lint (close the SPEC-052 upstream blind spot)

## Overview/Goal

SPEC-052 mechanizes the "抽象词必量化" discipline at the **AC layer**
(`lintAcQuantifiability`, wired into the `spec-create` / `spec-promote` gates).
SPEC-055 checks **requirement→AC coverage**. But a PRD requirement's own
`statement` text is never linted for quantifiability: a requirement like
`"首页要高质量"` enters the corpus unchallenged, is then "covered" by an equally
vague AC, and BOTH gates stay green — because SPEC-055 coverage is
REFERENCE-level (is `R-id` cited by some AC?), not content-level (is `R-id`
itself measurable?). This is the same "spec-sampling illusion" SPEC-055 set out
to kill, one tier too high for it to see, and it sits at the point where a
未量化 word has its LARGEST downstream blast radius (it corrupts every AC derived
from it). Source finding:
`knowledge-quantification-coverage-gap-requirement-layer-statemen`.

Goal: reuse the SPEC-052 lexical lint one tier up, at requirement write-time, so
a PRD requirement carrying an abstract quality word with no measurable token is
rejected deterministically — with the exact same word→fix feedback SPEC-052 gives.

## Scope

**IN**
- Extract a shared primitive `lintStatement(text: string): AcQualityFinding[]`
  in `@lore/core/ac-quality.ts`; re-express `lintAcQuantifiability` in terms of
  it, keeping its output byte-identical (regression-frozen).
- Apply the primitive in `RequirementService.addRequirement` — an
  un-quantifiable `statement` fails fast with `VALIDATION_ERROR` (CLI exit 4 —
  the codebase's single SSOT exit code for `VALIDATION_ERROR`, `utils.ts::exitCode`;
  exit 2 is reserved for CLI-usage errors, not business validation),
  mirroring `AcService.addCriterion`'s SPEC-052 wiring. The full candidate array
  is not re-linted; only the newly-added requirement's statement is checked
  (a pre-existing vague requirement is not retroactively blocked — additive,
  non-breaking).
- Config knob `workflow.requirement_quantifiable.enabled` (default `true`) —
  `false` disables the check (LOUD: no silent skip semantics needed, the write
  simply proceeds as pre-change).
- Feeding-pack-shaped error message: for each offending finding, name the
  requirement id, the abstract word, and the fix ("add a measurable token /
  benchmark anchor").

**OUT**
- ① Conversation-intent layer ("高质量首页" spoken to the agent, before any
  corpus write) — no deterministic write-event to gate; stays a CLAUDE.md prompt
  discipline + AskUserQuestion. Recorded, not built.
- ④ SPEC-055 content-level coverage upgrade — largely closed transitively once
  requirements are quantified at write-time; a separate spec if still wanted.
- Semantic/AI vagueness at the requirement layer (the SPEC-053 advisory class,
  e.g. "returns quickly enough" passing the wordlist) — a separate
  calibration-bearing supplement.
- A new PRD-write checkpoint gate. Rejected by design: a requirement is a
  substructure of `prd.extra.requirements`, with no natural independent
  write-transaction point to hang a checkpoint on; `RequirementService` is the
  single write path (mirrors `AcService`), so a service-layer lint covers every
  surface (CLI + MCP) without new gate machinery.

## Acceptance Criteria

(Structured, machine-checkable ACs authored via `lore ac add`; each covers R-1.)

- AC-RQ-1: `lintStatement` exists and is exported from `@lore/core`; returns ≥1
  finding for an abstract-word-without-measurable-token string and 0 findings for
  a quantified string.
- AC-RQ-2: `lintAcQuantifiability` delegates to `lintStatement` and its output is
  byte-identical to the pre-change implementation across the existing AC fixtures
  (regression).
- AC-RQ-3: `RequirementService.addRequirement` returns `VALIDATION_ERROR` on an
  un-quantifiable statement and succeeds on a quantified one.
- AC-RQ-4: `lore requirement add` exits 4 (VALIDATION_ERROR) on a vague statement
  and 0 on a quantified one (CLI e2e).
- AC-RQ-5: with `workflow.requirement_quantifiable.enabled: false`, a vague
  statement is accepted (knob honored).
- AC-RQ-6: `bun run typecheck` exits 0 and `bun run test` (both runners) passes.

## Design

**Decision — service-layer lint (Option A), not a new gate (Option B).**

- Option A (chosen): lint inside `RequirementService.addRequirement`. Single
  write path → both `lore requirement add` (CLI) and `lore_requirement_add`
  (MCP) inherit the check with zero adapter edits. Directly mirrors the SPEC-052
  precedent `AcService.addCriterion`, which is itself a service-layer lint (its
  gate exists only because `spec` has `spec-create`/`spec-promote` checkpoints).
- Option B (rejected): a `requirement-create` / PRD-write checkpoint through
  `GateEnforcer`. A requirement is not an independent doc; it is an element of
  `prd.extra.requirements` mutated via a dedicated service. There is no
  write-transaction seam analogous to a spec's draft→approved transition to gate,
  and hanging a checkpoint on every `CorpusService.set` of a PRD to diff its
  requirements array is over-engineering for zero added coverage over Option A.

**Shared primitive.** `ac-quality.ts` currently hard-codes the abstract-word +
measurable-token logic inside `lintAcQuantifiability(criteria)`. Extract the
per-statement core to `lintStatement(text): AcQualityFinding[]`;
`lintAcQuantifiability` becomes a thin per-criterion map that skips `script`-mode
ACs (oracle-bound by construction) and calls `lintStatement` on the rest. The
requirement path calls `lintStatement` directly. Regression: the existing
`ac-quality` test fixtures must stay green unchanged, proving the refactor is
behavior-preserving.

**Config resolution.** Add `resolveRequirementQuantifiableEnabled(config)` in the
same style as `resolveAcQuantifiableGateEnabled` (default `true`); read it in
`addRequirement` before linting.

**Error shape.** `VALIDATION_ERROR` with a message enumerating
`R-id: <word> → add a measurable token or benchmark anchor` per finding — the
same word→fix contract SPEC-052 surfaces, so the feedback is uniform across
layers.

**Dogfood.** This spec's own upstream requirement `R-1` on the root PRD is itself
a quantified statement; once this lands, `addRequirement` re-linting R-1 must
still accept it (self-consistency check folded into AC-RQ-5's fixture set).


## Acceptance Criteria (structured)

- [⚑] [script] AC-RQ-1: lintStatement is exported from @lore/core and returns >=1 AcQualityFinding for a statement with an abstract word and 0 measurable tokens, and returns exactly 0 findings for a quantified statement; test asserts both directions and exits 0
  script: test — bunx vitest run packages/core/tests/unit/ac-quality.test.ts
- [⚑] [script] AC-RQ-2: lintAcQuantifiability is re-expressed as a per-criterion map over lintStatement and its output stays byte-identical to the pre-change implementation across all existing ac-quality fixtures; regression test exits 0
  script: test — bunx vitest run packages/core/tests/unit/ac-quality.test.ts
- [⚑] [script] AC-RQ-3: RequirementService.addRequirement returns a VALIDATION_ERROR result for a statement carrying an abstract word with 0 measurable tokens and returns an ok result for a quantified statement; test asserts >=1 reject and >=1 accept case and exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-RQ-5: with workflow.requirement_quantifiable.enabled set to false in config, addRequirement accepts a vague statement that would otherwise be rejected; test asserts the disabled-knob accept path and the default-true reject path and exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/requirement-service.test.ts
- [⚑] [script] AC-RQ-6: bun run typecheck exits 0 with 0 type errors after the change across all packages and scripts
  script: test — bun run typecheck
- [⚑] [script] AC-RQ-4: lore requirement add exits with code 4 (VALIDATION_ERROR, the codebase SSOT exit code per utils.ts::exitCode) for a vague statement and code 0 for a quantified statement, measured by spawning the CLI from source and reading its exit code directly; e2e test asserts both codes and exits 0
  script: e2e — bunx vitest run packages/lore/tests/integration/requirement-quantifiable-cli.test.ts

## Code anchors

- packages/core/src/ac-quality.ts#lintStatement
- packages/core/src/config.ts#resolveRequirementQuantifiableEnabled
- packages/lore/src/service/requirement-service.ts
