---
name: product
description: "Use when user says 'write a PRD', 'product requirements', 'roadmap', 'user research', 'ideation', 'feature discovery', 'tech assessment', '写需求', '产品规划', or when creating product-level documentation before design/implementation."
---

# Product - Mode: $0

⛔ **Validate the mode BEFORE any file read.** `$0` must be EXACTLY one of: `ideation | discovery | prd | ux-research | roadmap | tech-assessment`. If `$0` is empty, a prose sentence, or any other word (e.g. `update`) → do NOT read `references/mode-$0.md` (guaranteed 404) — use AskUserQuestion to pick a mode from the table below. Note: updating an existing/living PRD is `prd` mode (mode-prd.md explicitly handles "PRD UPDATE"); there is no `update` mode.

Only after validation passes: Read `references/mode-$0.md`.

| Mode | Reference | Focus |
|------|-----------|-------|
| `ideation` | `references/mode-ideation.md` | Idea generation and evaluation |
| `discovery` | `references/mode-discovery.md` | Problem/solution discovery |
| `prd` | `references/mode-prd.md` | Product Requirements Document |
| `ux-research` | `references/mode-ux-research.md` | User research planning and synthesis |
| `roadmap` | `references/mode-roadmap.md` | Product roadmap |
| `tech-assessment` | `references/mode-tech-assessment.md` | Technical feasibility assessment |

## Cross-Cutting References (used by ALL modes)

| Reference | Purpose | When to Consult |
|-----------|---------|-----------------|
| [jtbd-framework.md](references/jtbd-framework.md) | Operationalized JTBD: switch interviews, forces of progress, outcome statements | User motivations, churn analysis, success metrics |
| [impact-mapping.md](references/impact-mapping.md) | Goal→Actors→Impacts→Deliverables traceability | Feature justification, roadmap alignment, scope decisions |
| [cross-cutting-concerns.md](references/cross-cutting-concerns.md) | Ethics, privacy, inclusive design, sustainability | **Every mode** — mandatory checklist before output |
| [product-wisdom.md](references/product-wisdom.md) | Success patterns, failure detectors, decision heuristics | Pattern recognition, sanity checks |
| [ideation-methods.md](references/ideation-methods.md) | Method selection, challenge techniques, validation | Brainstorming, prioritization, quick validation |
| [strategic-thinking.md](references/strategic-thinking.md) | Porter's, TAM/SAM/SOM, Strategy Canvas, Moat analysis | Market analysis, positioning, strategic decisions |

## ⛔ Brainstorming-First Gate (HARD — checked before any mode)

Before entering ANY product mode, verify:
1. Was `superpowers:brainstorming` invoked this session? → If NO and this is NEW feature work → invoke it first
2. Did the user explicitly skip brainstorming? → If YES → proceed
3. Is this a PRD update (not new creation)? → If YES → proceed

This gate prevents the #1 workflow failure: AI autopiloting through the entire Product→Design→Plan chain without validating user intent. Brainstorming is the ONLY stage that explores "what does the user ACTUALLY want" before we commit to a direction.

## Strategic Mindset
Act as strategic product partner, not order taker. Challenge assumptions.
- Most failures stem from unvalidated assumptions
- First idea is rarely the best — explore alternatives
- Ask hard questions: market reality, competition, user truth, execution risk, opportunity cost
- **Benchmark-first**: The software industry is mature — nearly every scenario has proven benchmark products. MUST identify top 1-3 benchmark products in the same domain before designing features or UX. Borrow market-validated patterns as baseline; never design from scratch.

## Sequential Thinking — Default Reasoning Engine
Product work is structured reasoning. **All modes default to `mcp__sequential-thinking__sequentialthinking` for core reasoning**:
- `prd`: Problem analysis → user definition → requirement derivation → scope tradeoffs → AC generation
- `ideation`: Multi-direction exploration → hypothesis testing → convergence
- `discovery`: Market analysis → competitive assessment → Go/No-go decision
- `roadmap`: Priority ranking → sequencing tradeoffs → format selection
- `tech-assessment`: Candidate evaluation → adopt/build decision
- `ux-research`: Study design → data→insight derivation → product recommendations

**Principle**: ST first, then output conclusions. Do not jump to comparison tables/pros-cons/PRD body directly.

## Inter-Mode Handoff Contracts

Each mode produces structured output that feeds the next mode. Handoffs are **explicit** — the output artifact of one mode becomes the input contract for the next.

### ideation → discovery

| Output (ideation) | Input (discovery) |
|-------------------|-------------------|
| Refined Idea Statement (1 paragraph) | Discovery Brief |
| Top 3 Opportunities (ranked) | Validation targets |
| Kill Risks identified | Risk hypotheses to validate |
| Validation Roadmap | Experiment design seeds |

**Handoff trigger**: Ideation recommends "Proceed to Discovery"
**Handoff action**: Pass refined idea statement + validation roadmap as discovery brief

### discovery → prd

| Output (discovery) | Input (prd) |
|--------------------|-------------|
| Market Reality Score | PRD strategic context |
| Evidence-backed user pain | PRD problem statement |
| Competitive landscape | PRD non-goals (don't compete here) |
| Validated assumptions | PRD requirements foundation |
| Adopt-First Gate result | PRD scope (adopt vs build) |

**Handoff trigger**: Discovery recommends "Go → PRD"
**Handoff action**: Link discovery doc as `derived-from` source for PRD

### ux-research ↔ all modes (bidirectional)

| UX Research produces | Consumed by |
|---------------------|-------------|
| Validated personas | PRD (target users), Ideation (role prompts) |
| Journey map updates | PRD (user journey), Discovery (pain points) |
| Insight cards | PRD (requirements), Roadmap (prioritization evidence) |
| Switch interview data | Discovery (competitive intel), JTBD analysis |
| Accessibility findings | PRD (NFRs), Cross-cutting concerns |

**Handoff trigger**: Any mode identifies research gap → route to ux-research
**Handoff action**: Research doc linked via `lore link <research> <target> --type=relates-to`

### prd → downstream skills

| Output (prd) | Consumer | Link Type |
|--------------|----------|-----------|
| Approved PRD | Design skill | `implements` |
| Requirements + AC | Implement skill | `implements` |
| AC | Test skill | `implements` |
| Goals + non-goals | Review skill | `relates` |

**Handoff trigger**: PRD status → `approved`
**Handoff action**: Downstream skills read the PRD via `lore get <prd-slug>` before starting work

### impact-mapping → roadmap / prd

| Output (impact-mapping) | Consumed by |
|------------------------|-------------|
| Goal-Actor-Impact-Deliverable map | Roadmap (prioritization justification) |
| Deliverable → Goal traceability | PRD (strategic context, scope guard) |
| Unvalidated impact hypotheses | Discovery (what to validate next) |

## Flow Constraints
- PRD is mandatory gate before technical/design work
- Recommended flow: ideation → discovery → prd
- Impact Map can be created at any point but MUST exist before roadmap
- UX Research can be triggered by any mode when evidence is insufficient
- Cross-cutting concerns checklist is mandatory for all mode outputs
- Anti-patterns: skipping validation, feature-first thinking, no success metrics, building without traceability

## Exit Criteria (all modes)

Every mode must satisfy before declaring "done":
1. Output artifact persisted in the lore corpus with correct type and links
2. Cross-cutting concerns checklist passed (see [cross-cutting-concerns.md](references/cross-cutting-concerns.md))
3. Next step recommendation provided (proceed / pivot / park / kill / more research)
4. Assumptions explicitly listed with confidence levels
