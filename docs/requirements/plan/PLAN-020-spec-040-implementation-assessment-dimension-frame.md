---
id: PLAN-020
type: plan
role: plan
title: "SPEC-040 Implementation — assessment dimension framework v2"
status: archived
priority: high
created: 2026-07-10
updated: 2026-07-10
tags: [spec-040, instrument, assess]
parent: SPEC-040
---
# PLAN — SPEC-040 implementation: assessment dimension framework v2

## Goal
Deliver SPEC-040 D1-D9 with all 12 script ACs green (AC-ADF-9 human AC verified by owner at closeout) and the full oracle suite passing (tsc + vitest + bun test).

## Task breakdown (serial — overlapping file anchors)
1. **T1 core layer** — `@lore/core` assessment.ts: additive schema ext (dimension_scores {score, confidence, based_on, reasoning≤200}, typed_gaps, typed_recommendations, unverifiable, rubric_warning, facts, source_versions), computeAssessmentFacts (incl. spec-less bundle, dangling ac_scope ids, knowledge-link pointer facts, tests_touched/attested-ratio signals), legacy-array derivation, extended clip pass. Covers AC-ADF-2, AC-ADF-10 (+ schema halves of 1/4).
2. **T2 prompt + service layer** — assess-template v6 + ASSESS_TEMPLATES registry (loud unknown-version), review-template truncation notice (D8), ai-provider-service validation + D4 grounding cross-check + facts persistence + source_versions, getPlanBundle knowledge_links pointer list, plan ac_scope write-validation in corpus-service. Covers AC-ADF-1, 3, 4, 5, 6, 8, 11.
3. **T3 surfaces + golden harness** — CLI assess render + MCP lore_assess render (typed tables + legacy), scripts/assess-golden.ts (--dry-run + scored mode), synthetic fixtures, pure aggregation fn (3-run majority + non-inferiority). Covers AC-ADF-7, 12, 13.

## Oracle
Per task: `bun run typecheck` + the task's AC-named test files + full `bun run test` before merge. Evidence recorded per SPEC-025; `lore verify` for script ACs after T3.

## Closeout
`lore assess` this plan (v5 instrument — the v6 instrument cannot assess its own delivery run, self-referential AC pattern per knowledge-assess-usage-patterns #10), owner AC-ADF-9 spot-check, retro knowledge doc.
