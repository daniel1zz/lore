---
id: KN-091
type: knowledge
role: knowledge
title: "SPEC-059 execution retro — shared lint primitive + exit-code SSOT correction (evidence over spec-prose)"
status: approved
priority: medium
created: 2026-07-20
updated: 2026-07-24
tags: []
parent: SPEC-059
links:
  - {id: PLAN-067, type: relates-to}
---
# SPEC-059 execution retro — shared-primitive extraction + an exit-code SSOT correction

## What landed

Requirement-layer quantifiability lint (SPEC-059), single vertical slice, one
worktree implementer, 6/6 ACs attested via `lore verify` (exit-code-derived).
`lintStatement(text)` extracted in `@lore/core/ac-quality.ts`,
`lintAcQuantifiability` re-expressed over it (regression-green),
`resolveRequirementQuantifiableEnabled` config brake, wired into
`RequirementService.addRequirement`.

## Reusable pattern — shared lint primitive across corpus tiers

The quantifiability discipline now has ONE lexical engine (`lintStatement`) reused
at two tiers: AC-layer (`lintAcQuantifiability`, SPEC-052) and requirement-layer
(`addRequirement`, SPEC-059). Same word→fix contract surfaces at both. Any future
tier that carries free-text quality statements (e.g. a PRD goal field, a
phase-checklist item) should call `lintStatement` rather than re-deriving the
abstract-word/measurable-token logic — the extraction is the SSOT.

## Process learning — an AI spec author mis-stated an exit-code convention; the implementer's oracle corrected it

I (spec author) wrote AC-RQ-4 + the spec prose + R-1 as "CLI exit 2" for the
`VALIDATION_ERROR` reject path. That was WRONG: the codebase's single SSOT
`utils.ts::exitCode` maps `VALIDATION_ERROR → 4` (exit 2 is reserved for
CLI-usage errors — unknown flags, mutually-exclusive conflicts — per SPEC-051).
SPEC-052's identical AC-layer lint also surfaces as exit 4.

The worktree implementer did NOT blindly follow the spec's prose — it implemented
and tested the CORRECT, consistent behavior (exit 4), and flagged the divergence
in its completion report rather than silently papering over it OR silently
introducing a one-off exit-2 special case that would have fractured the exit-code
SSOT. The orchestrator then verified `utils.ts::exitCode` directly (not from
memory), confirmed exit 4, and corrected AC-RQ-4 + spec prose + R-1 to match.

Lesson (dogfood): a spec is AI-authored and can carry a confidently-wrong
convention detail (exit codes, error-code names, config-key spelling). The
external oracle — here the actual `exitCode` switch — is authoritative over the
spec's prose. An implementer following "you execute, you never plan" is right to
implement the codebase-consistent truth and flag the spec for correction, not to
reproduce the spec's error. This is exactly why evidence beats spec-prose.

## Minor honest deviation (not AC-blocking)

`lintStatement` shipped returning `AcQualityFinding[]` (with `ac_id`), whereas the
spec Design section said "findings WITHOUT ac_id (caller supplies ac_id)". The AC
set (≥1/0 finding counts) is satisfied either way and all fixtures stayed green;
the signature choice is an implementation detail, recorded here rather than
left as an undocumented spec/impl gap.

## Provenance

Source finding: `knowledge-quantification-coverage-gap-requirement-layer-statemen`.
Spec: `spec-spec-059-requirement-layer-quantifiability-lint-close-spec`.
Assessment: `knowledge-assessment-implementation-spec-059-requirement-layer-q`.
