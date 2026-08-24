---
id: SPEC-040
type: spec
role: spec
title: "Assessment dimension framework v2: facts/judgment split + typed findings"
status: approved
priority: high
created: 2026-07-10
updated: 2026-07-27
tags: [assess, judge, rubric, calibration, spec-040, instrument]
parent: PRD-001
---
# SPEC-040 — Assessment dimension framework v2: deterministic-facts / judgment split + typed findings

> spec_kind: tech. Upstream: PRD-001 §14.7 (committed 2026-07-10, input-quality hardening — NOT an R2 unlock).
> Prerequisite-of: D5-L1 feed-forward (R2) — typed recommendations must exist before anything can consume them.
> v2 — revised after 3-lens adversarial review (schema/judge-behavior/testability); revision log in §Review.

## Overview/Goal

The v1 assess instrument (ASSESS_PROMPT_VERSION 5) is one-dimensional and its output is
programmatically unconsumable. Measured defects, each with a corpus evidence doc:

| # | Defect | Evidence |
|---|---|---|
| E1 | Rubric measures ONLY per-AC evidencing — no scope/evidence-integrity dimensions | `assess-template.ts` §Rubric Anchors |
| E2 | `gaps`/`recommendations` are free-text strings → "no downstream consumer reads them" | PRD §14 intro (measured 2026-07-06) |
| E3 | Judge re-derives facts code already knows; truncated materials scored as absent (30-50 pt distortion, 3×) | `knowledge-assess-material-budget-distortion` |
| E4 | Narrow plan judged against parent spec's FULL AC surface (63/100 despite complete in-scope delivery) | `knowledge-assess-usage-patterns` #1 |
| E5 | No judge uncertainty declaration; ±2 score noise unquantified | `knowledge-assess-usage-patterns` #9 |
| E6 | Review surface lacks the truncation transparency assess got in SPEC-028: PRD v0.8 review escalated at 0.60 purely because the 36k-char doc was cut mid-§13.1 and the judge could not tell "truncated" from "missing" | calibration record on PRD-001 approve, 2026-07-10 |

**Goal**: the assessment instrument becomes trustworthy enough to anchor score-gated
autonomy — deterministic facts computed in code and fed to the judge (never re-derived),
a typed judgment rubric restricted to dimensions the judge can actually ground in visible
material, machine-consumable findings, and a golden-set regression gate so no future
rubric/prompt version ships unmeasured.

**Instrument honesty principle (review outcome)**: a dimension the judge cannot ground in
bundle-visible material is a fabrication invitation and MUST NOT exist as a judge score —
it either becomes a deterministic fact or it is not measured at all.

## Design Decisions

- **D1 — Two-layer split.** New pure fn `computeAssessmentFacts(bundle, declaredCriteria, diffMeta?)`
  in `@lore/core` (`assessment.ts` stays schemas + pure helpers). Facts:
  - per-AC coverage (reuses `computeAcCoverage`, single derivation site);
  - per-task evidence completeness `{has_evidence, oracle_kinds[], attested_count, self_reported_count}`;
  - scope facts (declared plan `ac_scope` subset vs spec AC surface, D5, incl. dangling ids);
  - **knowledge-capture fact** (was a judge dimension; demoted per review J-F1): count + slugs of
    knowledge docs linked to the plan (`informs`/`relates-to`), supplied to the fn by the caller
    (`getPlanBundle` gains a `knowledge_links: {slug, sub_type, title}[]` pointer list — pointers
    only, never content);
  - **regression signals** (was a judge dimension; demoted per review J-F2): `tests_touched`
    (from `classifyDiffFilePriority` over diff file list), attested-evidence ratio. No 0-100
    "regression risk" score exists anywhere — the facts speak, nobody guesses.
  Facts are (a) rendered into the prompt as a `# Deterministic Facts` section and (b) persisted
  into `extra.assessment.facts` FROM THE COMPUTATION — never parsed back from judge output.
  **Facts are a frozen point-in-time audit snapshot** (like `judgment.truncated[]`/`prompt_version`),
  NOT a read-side cache: later changes to `computeAssessmentFacts` do not retro-invalidate stored
  facts, and AC-ADF-1's equality oracle is a creation-time invariant only (review S-F3).
  Facts are computed from the FULL bundle before any prompt truncation — coverage counts are
  immune to char budgets by construction (the E3 fix).
- **D2 — Judgment dimensions (three, all grounded).** `dimension_scores` — optional Zod record
  over the closed enum `{outcome, evidence_integrity, scope_fidelity}`, each
  `{score: 0-100 int, confidence: 0-1, based_on: "evidence"|"absence", reasoning: ≤200 chars}`.
  Grounding: outcome ← AC table + evidence; evidence_integrity ← attested-vs-self-reported facts;
  scope_fidelity ← D5 scope facts. ADDITIVE — all new fields `.optional()`, v1-shaped stored
  assessments parse unchanged (proven pattern: `judgment.reasoning_clipped?`). The dimension enum
  is **append-only**; stored-doc reads tolerate unknown dimension keys (tolerant read, review S-F5).
  Per-dimension `confidence` is **advisory-only, self-reported, uncalibrated**: rendered with an
  explicit "not an unlock input" note; no gating/consuming path may read it (PRD §14.2 discipline;
  review J-F5).
- **D3 — Typed findings via NEW fields + derivation (breaking change eliminated, review S-F1).**
  Existing `gaps: string[]` / `recommendations: string[]` are REQUIRED fields consumed by three
  render sites (`@lore/core` `renderAssessmentContent`, CLI `assess.ts`, MCP `tools.ts`) — their
  element type does not change. v6 judge output emits `typed_gaps[]:
  {dimension, severity: blocker|major|minor, ac_ref?, statement: ≤500}` and
  `typed_recommendations[]: {target: spec|plan|prompt|skill|process, action: ≤500, rationale: ≤300}`
  (both optional in the persisted schema); at persist time the legacy string arrays are DERIVED
  (`typed_gaps.map(g => g.statement)`, `typed_recommendations.map(r => r.action)`) so every
  existing consumer keeps working bit-for-bit. Render sites additionally gain typed tables when
  the typed arrays are present. All three render sites are in scope (review S-F2).
- **D4 — Grounding declaration replaces regex tripwire (review J-F3).** Every `ac_scores[]` entry
  and every dimension entry carries schema-forced `based_on: "evidence" | "absence"`. Mechanical
  post-parse cross-check (service-side, zero NLP): `based_on === "absence"` AND the entry's subject
  is in neither `unverifiable[]` (new judge-declared list `{material, reason ≤200}`) nor
  `truncated[]` → `rubric_warning` recorded on the assessment doc. Warning, never fatal.
- **D5 — Scope-fit.** Plans may declare `extra.ac_scope: string[]` — non-empty, validated at write
  time against the parent spec's declared AC ids (cross-entity pattern of task `extra.phase`).
  Pinned edge cases (review S-F4): empty array → `VALIDATION_ERROR`; plan parented under a PRD
  (no spec → `resolveDeclaredAcIds` null) declaring `ac_scope` → `VALIDATION_ERROR`;
  **post-edit staleness is loud at assess time**: `computeAssessmentFacts` marks ac_scope ids no
  longer on the spec as `dangling[]`, the prompt annotates them "(declared in plan scope but no
  longer on spec)", and a `rubric_warning` is recorded. When a valid subset is present the AC table
  marks out-of-scope rows and the output instruction restricts `ac_id` to the subset.
- **D6 — Versioned prompt registry.** `ASSESS_TEMPLATES: Record<number, AssessTemplateFn>`
  mirroring `REVIEW_TEMPLATES`; v5 builder retained as a registry entry for provenance (no
  byte-identical rendering guarantee — no live consumer re-executes v5; review J-F6);
  `ASSESS_PROMPT_VERSION` points at the active key. Looking up a `prompt_version` absent from the
  registry fails loud (`AI_PROVIDER_ERROR` naming the version), never throws uncaught (review T-F5).
- **D7 — Golden-set regression gate (honest sourcing + checkable rule, review T-F2/T-F3).**
  Fixtures: hand-curated synthetic `PlanBundle` snapshots with DESIGNED expected labels, checked
  into `packages/lore/tests/fixtures/assess-golden/` — the "seeded from real history" claim is
  dropped: assessment docs today record neither source doc versions nor an assessment-level human
  label (calibration records are review-bound and binary). **Accrual mechanism**: v6 persists
  `extra.assessment.source_versions: {doc_id, version}[]` (plan/spec/tasks at assess time) so real
  point-in-time fixtures can accrue from now on. Promotion rule (mechanically checkable): per
  fixture, the candidate runs N=3 times and takes the majority direction label
  (met-ish ≥80 / partial / not_met); candidate is promotable iff majority-label agreement with
  expected labels over the fixture set ≥ incumbent's (non-inferiority, ties pass). The
  aggregation/majority/comparison arithmetic is a pure fn, unit-testable with a scripted provider;
  live runs use the real provider (`--dry-run` lists fixtures + labels with zero provider calls
  and is the CI-safe path).
- **D8 — Review-surface truncation transparency (E6 fix).** `review-template.ts`: when the doc
  body is cut for budget, the review prompt appends a truncation notice section ("treat as present
  but unseen; escalations about unseen-ness must cite this notice") and the judgment records
  `truncated: true`. Assess's file-level diff manifest is NOT duplicated — one doc body, a boolean
  + notice suffices.
- **D9 — Output-size resilience (review J-F4).** The pre-validation clip pass
  (`clipOverlongReasoning`) extends to `dimension_scores[].reasoning` (≤200),
  `typed_gaps[].statement` (≤500), `typed_recommendations[].action` (≤500) / `.rationale` (≤300),
  `unverifiable[].reason` (≤200) — overlong text is clipped with `…`, never a Zod hard-fail; the
  prompt states every cap. The existing one-corrective-retry policy is unchanged.

## Scope

**In**: `@lore/core` `assessment.ts` (additive schema ext + `computeAssessmentFacts` + derivation
+ extended clip), `getPlanBundle` knowledge-links pointer list (`corpus-service.ts`),
`packages/lore/src/ai/assess-template.ts` (v6 + registry), `review-template.ts` (D8),
`ai-provider-service.ts` (validation + D4 cross-check + registry lookup), plan `ac_scope`
write-validation (`corpus-service.ts`), all three assess render sites (core/CLI/MCP), golden
harness (`scripts/assess-golden.ts`) + synthetic fixtures + pure aggregation fn.

**Out**: L1 feed-forward injection (R2 — this spec is its prerequisite, not its delivery);
autonomy staging / thresholds (§14.3 untouched); judge scores for regression risk or knowledge
capture (facts only, by design); any daemon; semantic search; code-diff review (§12 exclusion).

## Acceptance Criteria

Structured ACs via `lore ac add` (script commands name explicit runner + file; service/ai tests
are vitest on InMemoryStore/InMemoryAIProvider — no bun:sqlite dependency; review T-F1):

- AC-ADF-1 facts creation-time invariant (judge contradiction cannot alter persisted facts)
- AC-ADF-2 legacy round-trip incl. `gaps: [string]` byte-unchanged + v2 full round-trip + derivation
- AC-ADF-3 malformed typed findings → one corrective retry → `AI_PROVIDER_ERROR`, no doc
- AC-ADF-4 `based_on: absence` without matching `unverifiable`/`truncated` entry → `rubric_warning`
- AC-ADF-5 `ac_scope` write validation (unknown id / empty / no-spec-parent → `VALIDATION_ERROR`)
- AC-ADF-6 registry version dispatch + unknown-version fails loud
- AC-ADF-7 golden dry-run deterministic listing, zero provider calls
- AC-ADF-8 review truncation notice + `truncated: true` (36k regression fixture)
- AC-ADF-9 (human) owner v5↔v6 side-by-side with concrete criterion
- AC-ADF-10 facts boundary: spec-less bundle; facts immune to prompt truncation (E3 oracle)
- AC-ADF-11 ac_scope state: post-edit dangling id → prompt annotation + `rubric_warning`; subset==full → no out-of-scope marks
- AC-ADF-12 golden scored-mode arithmetic (3-run majority + non-inferiority) deterministic under scripted provider
- AC-ADF-13 all three render sites render legacy string arrays AND typed tables (snapshot)

## Review

3-lens adversarial review applied 2026-07-10 (schema/storage-compat, judge-behavior, testability):
- CRITICAL fixed: D3 no longer mutates `gaps`/`recommendations` element types (new `typed_*` fields + derivation).
- HIGH fixed: `knowledge_capture`/`regression_risk` demoted from judge dimensions to deterministic facts (grounding); golden fixture sourcing honesty (synthetic now + `source_versions` accrual); promotion rule made mechanically checkable (3-run majority, pure aggregation fn); `ac_scope` post-edit staleness made loud; renderer SSOT name corrected (`renderAssessmentContent`) + CLI/MCP duplicate sites in scope.
- MED fixed: `based_on` schema field replaces absence-regex; clip pass extended to all new long fields; per-dimension confidence marked advisory-only; dimension enum append-only + tolerant read; AC runner assignments made explicit; AC-ADF-9 criterion concretized.
- LOW fixed: byte-identical v5 promise dropped (registry provenance only).


## Acceptance Criteria (structured)

- [⚑] [script] AC-ADF-7: Golden-set harness dry-run exits 0 and lists every fixture with its human-outcome label in deterministic order, zero provider calls
  script: other — bun scripts/assess-golden.ts --dry-run
- [⚑] [script] AC-ADF-8: Review prompt for an oversized doc body contains the truncation notice section and the judgment records truncated: true (regression fixture: 36k-char doc)
  script: test — bunx vitest run packages/lore/tests/unit/ai/review-template-truncation.test.ts
- [⚑] [script] AC-ADF-1: Facts are computation-persisted at creation time: extra.assessment.facts equals computeAssessmentFacts output for the seeded bundle even when the scripted judge response contradicts them (creation-time invariant only)
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess-facts.test.ts
- [⚑] [script] AC-ADF-2: A v1-shaped stored assessment (gaps/recommendations as string arrays, no new fields) round-trips byte-unchanged through schema validation and rendering; a v6 output with typed_gaps/typed_recommendations persists derived legacy string arrays alongside the typed fields
  script: test — bunx vitest run packages/core/tests/assessment-schema-compat.test.ts
- [⚑] [script] AC-ADF-3: Malformed typed findings trigger the existing single corrective retry then AI_PROVIDER_ERROR with no doc created (sequence-mode InMemoryAIProvider oracle)
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess-typed.test.ts
- [⚑] [script] AC-ADF-4: An ac_score or dimension entry with based_on=absence whose subject is in neither unverifiable[] nor truncated[] records a rubric_warning on the assessment doc; with a matching unverifiable entry no warning is recorded; warnings are never fatal
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess-grounding.test.ts
- [⚑] [script] AC-ADF-5: plan extra.ac_scope validation fails loud with VALIDATION_ERROR for: an id not declared on the parent spec, an empty array, or a plan whose parent is not a spec; a valid subset marks out-of-scope AC rows in the prompt and restricts the output-instruction id list to the subset
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-ac-scope.test.ts
- [⚑] [script] AC-ADF-6: ASSESS_TEMPLATES registry dispatches by version key with v5 retained as a provenance entry; requesting a version absent from the registry returns AI_PROVIDER_ERROR naming the version, never an uncaught throw
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-template-registry.test.ts
- [○] [human] AC-ADF-9: Owner spot-check on one real plan: every v6 typed_recommendation names a target and an action executable without re-reading the plan, and v6 surfaces at least one dimension-attributed gap the v5 assessment did not
  human: Owner runs v5 and v6 on the same real plan and compares side-by-side
- [⚑] [script] AC-ADF-10: computeAssessmentFacts handles a spec-less bundle (scope facts explicitly absent, no throw) and is computed from the full bundle before prompt truncation: coverage counts are identical whether or not prompt sections were truncated (E3 oracle)
  script: test — bunx vitest run packages/core/tests/assessment-facts.test.ts
- [⚑] [script] AC-ADF-11: After the parent spec drops an AC id still named in a plan's ac_scope, assess marks the id in facts.dangling, annotates it in the prompt, and records a rubric_warning; an ac_scope equal to the full declared set produces no out-of-scope marks
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-ac-scope-staleness.test.ts
- [⚑] [script] AC-ADF-12: The golden-set aggregation pure fn computes per-fixture 3-run majority direction labels and the non-inferiority comparison deterministically under a scripted provider, including tie-passes and a regression case where the candidate loses
  script: test — bunx vitest run packages/lore/tests/unit/ai/assess-golden-aggregation.test.ts
- [⚑] [script] AC-ADF-13: All three assess render sites (core renderAssessmentContent, CLI assess command output, MCP lore_assess tool output) render legacy string gaps/recommendations unchanged and render typed tables when typed arrays are present (snapshot oracle)
  script: test — bunx vitest run packages/lore/tests/unit/assess-render-sites.test.ts
- [⚑] [script] AC-040-SCOPE-1: lore assess emits a non-blocking scope-mismatch warning (in --json under a stable key and in text output) when the provided --diff/--diff-file file set intersects the plan's task file_anchors in fewer than half the diff's files, naming the likely-too-wide range; when no plan task declares anchors the check is skipped (no warning, not an error); the assessment still runs and persists in both cases; at least 1 test file runs and exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-assess.test.ts

## Code anchors

- packages/lore/src/ai/assess-golden-aggregation.ts
- packages/core/src/assessment.ts#computeScopeMismatchWarning
