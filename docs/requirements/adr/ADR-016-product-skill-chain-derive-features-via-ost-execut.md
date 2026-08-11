---
id: ADR-016
type: adr
role: decision
title: "Product skill chain: derive features via OST, execute graded validation, benchmark-first"
status: draft
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: [product, skills, validation, workflow]
parent: PRD-001
---
# Context

The `lore-product` chain (ideation -> discovery -> prd) reliably produced polished documents that were shallow in two specific ways, reported by the owner as "I still have to think up the features myself, and AI validation is always rough":

1. **No derivation step.** Ideation produced divergent role opinions; discovery produced market signal. Neither produced a feature list, so scope defaulted to whatever the human dictated and the AI transcribed it.
2. **Validation was never executed.** Discovery emitted a "validation roadmap" and the chain went straight to PRD. Requirements entered the PRD with the authority of facts while resting on nobody's observed behavior.
3. **The chain's own entry gate was dead.** Both `lore-product/SKILL.md` and `mode-prd.md` gated on `superpowers:brainstorming`, a skill that does not exist on this machine (verified by filesystem scan). A HARD gate pointing at a missing skill degrades to no gate.

Survey of 5 leading community PM skill repos (mattpocock/skills 360K installs, refoundai/lenny-skills, deanpeters/product-manager-skills, phuryn/pm-skills, assimovt/productskills, wondelai/skills) found our multi-agent orchestration and corpus persistence were ahead, and that the gap was exactly three mechanisms they had and we lacked.

# Decision

Adopt three mechanisms into the `lore-product-*` family, and normalise the family naming.

**M1 - Features are derived, not invented.** New mode `opportunity` implements Teresa Torres' Opportunity Solution Tree: exactly one measurable outcome (baseline + target) -> opportunities framed as customer needs and gated on >=2 independent tiered evidence sources -> >=3 materially different solutions per opportunity (hard floor, with a forced-diversity axis table) -> per-solution experiment carrying a kill condition stated before the run. A solution-in-disguise detector rejects feature-shaped "opportunities".

**M2 - Validation is executed and graded.** New mode `validate` implements Cagan's four risks (value/usability/feasibility/viability), each with its cheapest test and a numeric pass bar, plus a multiplicative problem score (Frequency x Intensity x Workarounds x WTP, 1-625; >=250 proceed, <100 kill) where every dimension must cite evidence on a 6-tier product-evidence ladder (E1 observed behaviour ... E6 stated intent). Multiplicative, not additive, so a never-attempted-workaround dimension cannot be averaged away. Output is a Validation Ledger whose rows are exactly `validated` / `refuted` / `unvalidated` - there is deliberately no state meaning "we reasoned about it".

**M3 - Feature candidates start from observed market reality.** New skill `lore-product-benchmark` produces an evidence-backed Feature Matrix (table-stakes / differentiator / trap / gap) with a source-tier ladder where hands-on product use outranks docs outranks third-party reviews, and where LLM recall is explicitly NOT a source (candidate generation only). `gap` rows feed M1.

**Wiring.** `discovery -> prd` and `opportunity -> prd` are no longer legal edges. PRD Phase 1C requires every requirement to carry `source` (OST leaf / benchmark row / user decision / constraint) and `validation` (copied from the Ledger, never asserted during drafting); a P0 whose value risk is unvalidated must be demoted, preceded by a validation task, or recorded with the user's explicit words as an `accepted bet`. The dead brainstorming gate is replaced by an Evidence-First gate ("model recall is E6") and an Upstream Chain gate. `lore-product-lens` gains a mandatory Phase 4 that routes every finding back into the corpus and requires dropped findings to be dropped on the record.

**Naming.** The product family is `lore-product-*`: `lore-product` (hub, 8 modes), `lore-product-benchmark` (new), `lore-product-lens`, `lore-product-to-prd` (renamed from `lore-to-prd`, and now self-declares that it bypasses the chain so its output inherits `unvalidated`).

# Consequences

- Feature scope becomes a derived artifact traceable to an evidenced need; "what should we build" has an owner mode.
- Rough validation becomes visible rather than absent: unrun experiments surface as `unvalidated` in the PRD instead of silently reading as validated.
- The chain is longer. For low-risk improvements a Minimal-PRD short-circuit waives benchmark + opportunity while keeping the validation field mandatory.
- Distribution surface: 297 asset files (was 294). Both conformance manifests plus the generated sha256 manifest updated.
- Failure mode retired: a HARD gate may never reference a skill that is not verifiably installed.
