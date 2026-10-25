---
id: SPEC-200
type: spec
role: spec
title: "The approval judge rejects patch-shaped designs: design-necessity dimension, plans judged by default"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: [review, design, governance]
---
## Overview/Goal

The approval gate must refuse a design that patches instead of designing. On 2026-10-18 a spec and plan (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune, plan-ambient-state-read-once-at-the-entry-owned-only-prune-user) passed three AI reviews with "approve" while introducing a stopgap seam, a bespoke text-scanning check with a ratchet ledger, a transitional AsyncLocalStorage bridge, process fallbacks and a phased migration. The reviews even tightened the check. The judge had no dimension for design necessity: its prompt (`packages/lore/src/ai/review-template.ts` `assembleReviewPrompt`, prompt version v3) scores structure only. Separately, plans are not in the default judged types (BR-281), so a reject verdict on a plan does not stop its approval.

Goal:

1. The judge evaluates **design necessity** for every spec, plan and ADR, and rejects a document that introduces transitional scaffolding, a bespoke check guarding a design constraint, a fallback that hides a missing input, or a phased migration, when an end-state design would make them unnecessary.
2. A plan is judged by default, like specs and ADRs, so that verdict gates its approval.

No new check script, linter or scanner is added: the existing approval gate (`review-judgment` checkpoint, worst verdict of the current version decides) is the only enforcement point.

## Scope

In scope: `packages/lore/src/ai/review-template.ts` (new prompt version v4, registered and made current; v1–v3 stay frozen), the default of `workflow.review.judgment_required_types` in `packages/core/src/config.ts` (add `plan`), the tests that pin the prompt version and key list, and one sentence in the shipped produce rule fragment (`assets/context/` fragment rendered as `.claude/rules/lore-corpus-workflow-produce.md`) stating the same principle for authors.

Out of scope: a deterministic detector of "patch-ness" (would itself be the bespoke check this spec rejects); changing judge models or confidence thresholds; re-judging existing approved documents.

## Design

**D1 — Design-necessity dimension (prompt v4).** v4 = v3 plus one RULES section, applied to every document type. The judge must answer: does the document introduce any of (a) a stopgap or temporary seam, (b) a bespoke check, scanner or ledger whose purpose is to guard a design constraint, (c) a fallback that silently substitutes a value for a missing required input, (d) a phased or transitional migration with intermediate states; and if so, would an end-state design make it unnecessary? If yes, the verdict is `reject` with a finding whose dimension is `design_necessity`, naming each item and the end-state alternative. A check, fallback or phase that the end-state design itself requires (e.g. a behavioural acceptance test of the design, a user-visible degraded mode the spec defines) is not a finding; the document must say why it is necessary. The prompt version recorded on each judgment is `v4`.

**D2 — Plans are judged by default.** The default `workflow.review.judgment_required_types` becomes `["spec", "adr", "plan"]` (BR-281 modified). A project that lists its own types is unchanged.

**D3 — Author-side statement.** The shipped produce rule gains one sentence: design the end state; do not introduce stopgaps, guard checks, fallbacks or phased migrations that the end-state design would make unnecessary — the approval judge rejects them. This informs authors; enforcement is D1 + D2. It deliberately has no acceptance criterion: a test pinning that a sentence exists in a rules file would be exactly the guard check D1 rejects.

**Rollout.** Under the new default, a plan already in draft needs a non-self judgment of its current version before it can be approved (a missing or self-judgment is refused, as for specs and ADRs today). This is intended; the refusal names the review command.

## Acceptance Criteria

Structured criteria via `lore ac add`: AC-DN-1 (v4 current, dimension present, v1–v3 byte-frozen), AC-DN-2 (plan approval refused on a reject verdict by default), AC-DN-3 (validation on the real judge; inputs pinned as fixtures `packages/lore/tests/fixtures/design-necessity/patch-shaped-spec.md` = spec-ambient-state-is-read-once-at-the-entry-owned-only-prune v19 body, and `.../end-state-spec.md` = the same goal written as end state only: the 2026-10-18 spec content is rejected under v4 on design_necessity, and a control spec without such items is not rejected on that dimension).


## Acceptance Criteria (structured)

- [⚑] [script] AC-DN-1: The v4 review prompt builder, for a spec, a plan and an ADR, contains the design_necessity rule naming the four item classes and the end-state test, and stays byte-frozen; the current version is v4 or later (v5 since spec-design-necessity-rule-v5-separate-what-a-design-needs-from); v1-v3 builders are byte-identical to before. [Correction 2026-10-18: originally 'the current review prompt version is v4'; v5 superseded it as current and the oracle now asserts v5 current while v4 stays frozen.]
  script: test — bunx --bun vitest run packages/lore/tests/unit/ai/review-template-v4.test.ts && echo 'AC-DN-1 PASS: v4 current with design_necessity; v1-v3 frozen'
  other_command=2
- [⚑] [script] AC-DN-2: With default review settings, lore approve on a plan whose current version carries a reject judgment exits 4 naming the review-judgment checkpoint and leaves the plan in draft; a project whose judged types are [spec] approves the same plan with exit 0.
  script: test — bunx --bun vitest run packages/lore/tests/integration/plan-approval-judged-by-default.test.ts && echo 'AC-DN-2 PASS: plan approval gated by default'
  other_command=2
- [○] [human] AC-DN-3: Under the current review prompt (v5; v4 over-applied, see correction) the real judge rejects the 2026-10-18 patch-shaped spec on design_necessity and raises no design_necessity finding on the end-state control spec, in two runs each. [Correction 2026-10-18: originally 'under prompt v4'; under v4 the control was rejected with run-to-run contradictory findings and itself carried a transitional legacy_skip; rule refined as v5, control corrected; pass bar unchanged. This criterion validates AI-judge behaviour, which no runner can attest, so it no longer cites BR-1237 for landing; the deterministic part of BR-1237 (the prompt carries the rule) is gated by AC-DN-1.]
  human: Fixtures packages/lore/tests/fixtures/design-necessity/patch-shaped-spec.md and end-state-spec.md (corrected per spec-design-necessity-rule-v5 D1). Throwaway corpus, dist/lore at prompt v5, lore review twice each. Expect (a) reject with design_necessity naming ledger/ratchet, seam, transitional bridge; (b) no design_necessity reason in either run.
