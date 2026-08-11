---
id: KN-090
type: knowledge
role: knowledge
title: "Quantification-coverage gap — requirement-layer statements are un-linted (SPEC-052/055 blind spot)"
status: approved
priority: medium
created: 2026-07-20
updated: 2026-07-24
tags: []
parent: SPEC-059
links:
  - {id: SPEC-088, type: relates-to}
  - {id: SPEC-055, type: relates-to}
  - {id: PLAN-067, type: informs}
---
# Quantification-coverage gap: the requirement layer is un-linted

## Finding

Lore mechanizes the "抽象词必量化" discipline at the **AC layer** (SPEC-052
`lintAcQuantifiability`, wired into `spec-create`/`spec-promote`) and adds a
semantic-vagueness advisory at review time (SPEC-053). SPEC-055 then checks
**requirement→AC coverage**. But there is a hole one tier UP from the AC:

> **A PRD requirement's own `statement` text is never linted for
> quantifiability.** A requirement like `"首页要高质量"` enters the corpus
> unchallenged, gets "covered" by an equally vague AC, and BOTH the
> `spec-*` quantifiability gate and the SPEC-055 coverage oracle stay green —
> because coverage is REFERENCE-level (is `R-id` referenced by some AC?), not
> content-level (is `R-id` itself measurable?).

The worked example that surfaced it: a user asks for "帮我生成一个高质量的首页".
"高质量" is a compound abstract concept (perf / visual / a11y / responsive /
conversion / code-quality — each independently quantifiable + oracle-bindable),
but nothing in the corpus forces that decomposition at the moment the *goal*
is recorded. The AC gate only fires once someone has already written an AC.

## Evidence (code, verified this session — not from memory)

- `packages/core/src/requirement.ts:51` — `statement: z.string().min(1).max(2000)`;
  zero references to `lintAc*` / `quantif` / `ac-quality` in the whole file. The
  `superRefine` at `:66` enforces only id-grammar + uniqueness, no measurability.
- `packages/lore/src/service/requirement-service.ts` — `addRequirement`'s
  `VALIDATION_ERROR` paths are all STRUCTURAL (id format, duplicate ids, bounds);
  no quantifiability lint.
- `packages/core/src/ac-quality.ts:223` — `lintAcQuantifiability(criteria:
  AcceptanceCriterion[])` is typed to AC objects only; reusing it on a
  requirement needs either an adapter (statement → AC-shaped) or extracting a
  lower `lintStatement(text): AcQualityFinding[]` primitive both call sites share.

## Why it matters

SPEC-052's premise is "the spec is AI-authored, so the only human/AI-legible
gate on quality must be deterministic." The SAME premise applies to
requirements: a PRD is AI-authored too. An un-quantified GOAL is a strictly
worse leak than an un-quantified AC — it corrupts everything downstream and the
existing coverage oracle actively MASKS it (green coverage on a vague pair).
This is exactly the "spec-sampling illusion" SPEC-055 set out to kill, one tier
too high for SPEC-055 to see.

## Fix direction (for a follow-up tech-spec, not decided here)

1. Extract `lintStatement(text): AcQualityFinding[]` as the shared primitive;
   re-express `lintAcQuantifiability` in terms of it (REGRESSION-frozen).
2. Apply it in `RequirementService.addRequirement` (fail-fast at
   `lore requirement add`, mirroring `AcService.addCriterion`'s SPEC-052 wiring).
3. Optional deterministic gate at the PRD-write path (analogous to the
   `spec-*` `acQuantifiable` predicate), config-toggled
   (`workflow.gates.<cp>.requirement_quantifiable.enabled`).
4. `human`-mode requirements with an unavoidable abstract word must carry an
   explicit measurable rubric or a benchmark anchor — same escape valve
   SPEC-052 gives `ai`/`human`-mode ACs.

Cost is low: it is the SPEC-052 lint reused one layer up, not new machinery.

## Scope note

Deterministic LEXICAL lint only — the SPEC-053 semantic-advisory class
("returns quickly enough" passes the wordlist yet is unmeasurable) would apply
at the requirement layer too, but that is a separate, calibration-bearing
supplement, not part of this gap.
