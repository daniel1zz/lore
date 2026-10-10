---
name: lore-product
description: "Product work from idea to PRD across 9 modes: ideation, discovery, opportunity (derive the feature set via an Opportunity Solution Tree), validate (run four-risk experiments and grade the evidence), decompose (expand a validated solution into a user story map), prd, ux-research, roadmap, tech-assessment. Use when user says 'write a PRD', 'product requirements', 'roadmap', 'user research', 'ideation', 'feature discovery', 'tech assessment', 'what should we build', 'is this worth building', 'validate this idea', '写需求', '产品规划', '该做什么功能', '验证一下这个功能', or when creating product-level documentation before design/implementation."
---

# Product - Mode: $0

⛔ **Validate the mode BEFORE any file read.** `$0` must be EXACTLY one of: `ideation | discovery | opportunity | validate | decompose | prd | ux-research | roadmap | tech-assessment`. If `$0` is empty, a prose sentence, or any other word (e.g. `update`) → do NOT read `references/mode-$0.md` (guaranteed 404) — use AskUserQuestion to pick a mode from the table below. Note: updating an existing/living PRD is `prd` mode (mode-prd.md explicitly handles "PRD UPDATE"); there is no `update` mode.

Only after validation passes: Read `references/mode-$0.md`.

| Mode | Reference | Focus |
|------|-----------|-------|
| `ideation` | `references/mode-ideation.md` | Idea generation and evaluation (benchmark-grounded) |
| `discovery` | `references/mode-discovery.md` | Market/problem validation with a quantified Problem Score |
| `opportunity` | `references/mode-opportunity.md` | **Derive the feature set** — Opportunity Solution Tree |
| `validate` | `references/mode-validate.md` | **Execute experiments** — four risks, evidence-graded Validation Ledger |
| `decompose` | `references/mode-decompose.md` | **Expand a validated solution** into a user story map; requirements are read off it |
| `prd` | `references/mode-prd.md` | Product Requirements Document |
| `ux-research` | `references/mode-ux-research.md` | User research planning and synthesis |
| `roadmap` | `references/mode-roadmap.md` | Product roadmap |
| `tech-assessment` | `references/mode-tech-assessment.md` | Technical feasibility assessment |

## The Two Questions This Skill Exists To Answer

Two failures dominate AI-assisted product work, and each has one mode that owns it:

| Failure | Symptom | Owner |
|---------|---------|-------|
| **"The AI keeps asking me what to build"** | Feature lists come from whoever is in the room; the AI transcribes rather than derives | `opportunity` — features are *derived* from an outcome through evidenced needs, never invented |
| **"It says validated but it's guesswork"** | A validation plan is written and never executed; requirements enter the PRD with the confidence of facts | `validate` — experiments actually run, results graded E1-E6, failures reported |
| **"The output is coarse"** | A one-line feature yields a one-line requirement; the twenty decisions inside it get invented while drafting the PRD | `decompose` — a story map with unhappy paths forced onto it; requirements are read off, not thought up |

⛔ Skipping these three is what makes the output feel thorough and *be* shallow. They are where product work stops being a document-generation exercise.

**Worked examples exist — read the relevant one before producing that artifact.** Output granularity anchors on the exemplar the model has seen, and these are calibrated to the expected depth: `references/example-ost.md` (includes a deliberately bad tree), `references/example-validation-ledger.md` (the expensive experiment fails), `lore-product-benchmark/references/example-feature-matrix.md`.

## Cross-Cutting References (used by ALL modes)

| Reference | Purpose | When to Consult |
|-----------|---------|-----------------|
| [jtbd-framework.md](references/jtbd-framework.md) | Operationalized JTBD: switch interviews, forces of progress, outcome statements | User motivations, churn analysis, success metrics |
| [impact-mapping.md](references/impact-mapping.md) | Goal→Actors→Impacts→Deliverables traceability | Feature justification, roadmap alignment, scope decisions |
| [cross-cutting-concerns.md](references/cross-cutting-concerns.md) | Ethics, privacy, inclusive design, sustainability | **Every mode** — mandatory checklist before output |
| [product-wisdom.md](references/product-wisdom.md) | Success patterns, failure detectors, decision heuristics | Pattern recognition, sanity checks |
| [ideation-methods.md](references/ideation-methods.md) | Method selection, challenge techniques, validation | Brainstorming, prioritization, quick validation |
| [strategic-thinking.md](references/strategic-thinking.md) | Porter's, TAM/SAM/SOM, Strategy Canvas, Moat analysis | Market analysis, positioning, strategic decisions |

## ⛔ Governance — batched (the only flow)

Every user stop and review in this skill's modes runs inside `~/.claude/skills/shared/batched-governance.md`: user questions join the ONE S1 decision interview, drafts are produced without stopping, reviews run once over the whole bundle (S3), and the user approves once (S4). PRD mode's Phase 1A / 1C / 2 / 3.5 are its PRD-side contributions to S1 / S1 / S3 / S4.

## ⛔ Evidence-First Gate (HARD — checked before any mode)

Before entering ANY product mode, verify the mode's inputs are **evidence, not recall**:
1. Does this mode require market/competitor facts? → the Feature Matrix from `lore-product-benchmark` must exist and be ≤2 quarters old
2. Does it require user pain claims? → each carries an E1-E6 tier (see `references/mode-validate.md`); E6-only claims are marked `⚠️ unevidenced`
3. Is this a PRD update, or an explicit user waiver? → proceed, and record which evidence was skipped

⛔ **Model recall is E6.** It generates candidates to verify; it is never a source. The moment a mode's output rests on "I know this category", the entire downstream chain inherits a guess and hides it behind structure.

This gate prevents the #1 workflow failure: AI autopiloting through the whole Product→Design→Plan chain, producing confident artifacts nobody ever checked against reality.

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

### discovery → opportunity

| Output (discovery) | Input (opportunity) |
|--------------------|---------------------|
| Problem Score ≥250 with tiered evidence | Proof the outcome is worth pursuing |
| Evidence-backed user pain | Opportunity candidates (needs, not features) |
| Competitive landscape + Adopt-First result | Solution-space constraints, non-goals |
| Unvalidated assumptions | Experiment backlog seeds |

**Handoff trigger**: Discovery recommends "Go → Opportunity"
**Handoff action**: `lore link <ost> <discovery-doc> --type=implements`

### opportunity → validate

| Output (opportunity) | Input (validate) |
|---------------------|------------------|
| Selected branch: opportunity + ≥3 solutions | The set to test |
| Per-solution experiment with kill condition | The test plan to execute |
| Rejected branches with reasons | Guard against re-litigating settled ideas |

**Handoff trigger**: One branch selected
**Handoff action**: Run the experiments — this is execution, not documentation

### validate → decompose → prd

| Output (validate) | Input (decompose) |
|-------------------|-------------------|
| Solutions `✅ validated` on value + usability | The only things legal to map — mapping a refuted solution is elaborate fiction |
| Refuted solutions | PRD non-goals, carrying the number that killed them |

| Output (decompose) | Input (prd) |
|--------------------|-------------|
| Above-the-line story map rows | One requirement each, provenance already attached |
| Unhappy-path rows (empty / error / return / overload) | Requirements tagged `⚠️ unvalidated` — validation tested the happy path only |
| Below-the-line rows | Next slice, recorded so they are not rediscovered mid-build as "new requirements" |

| Output (validate) | Input (prd) |
|-------------------|-------------|
| Validation Ledger rows (`validated` / `refuted` / `unvalidated`) | Per-requirement `validation` field — copied, never re-asserted |
| Problem Score + dimension evidence | PRD problem statement |
| Refuted solutions | PRD non-goals, with the evidence that killed them |
| OST leaf ids | Per-requirement `source` field |

**Handoff trigger**: Experiments executed (or explicitly marked not-run)
**Handoff action**: `lore link <prd> <ledger> --type=implements`; every P0 `unvalidated` resolved per mode-prd Phase 1C

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

**Canonical chain (new product / new feature bet):**

```
lore-product-benchmark → ideation → discovery → opportunity → validate → decompose → prd → design → plan
   (what exists)        (diverge)  (worth it?)  (derive what) (does it    (what it    (record)
                                                              work?)      actually is)
```

- ⛔ **`discovery → prd` is not a legal edge.** Discovery proves a problem is worth solving; it never establishes what to build. Skipping `opportunity` is exactly how a feature list ends up being whatever the author thought of.
- ⛔ **`opportunity → prd` skipping `validate` is not legal either** unless every carried requirement is marked `⚠️ unvalidated` or `🎲 accepted bet` in the PRD.
- ⛔ **`validate → prd` skipping `decompose` is illegal when the change adds a step to the user's journey** — that is exactly when the surrounding steps break in ways nobody enumerated.
- **Short-circuit allowed** for a Minimal PRD (improvement, <2wk, low risk, no new user-facing bet, touching a single existing step): benchmark + opportunity + decompose may be waived; the `validation` field stays mandatory.
- PRD is a mandatory gate before technical/design work
- Impact Map can be created at any point but MUST exist before roadmap
- UX Research can be triggered by any mode when evidence is insufficient
- Cross-cutting concerns checklist is mandatory for all mode outputs
- Anti-patterns: skipping validation, feature-first thinking, no success metrics, building without traceability

### Sibling skills in the `lore-product-*` family

| Skill | Role in the chain |
|-------|------------------|
| `lore-product-benchmark` | Upstream of everything — evidence-backed Feature Matrix of what already ships |
| `lore-product-lens` | Downstream audit — 6-dimension review of a built/in-flight product; its findings re-enter as opportunities |
| `lore-product-to-prd` | Shortcut — synthesizes an existing conversation into a PRD + issue tracker entries. ⛔ Bypasses this chain by construction, so its output inherits `⚠️ unvalidated` on every requirement |

## PRD Update Flow (SPEC-080 — outline authoring, product round)

Updating the living root PRD is `prd` mode ("PRD UPDATE" in `references/mode-prd.md`) — it is NEVER a wholesale `lore set` content edit. Since SPEC-080, the PRD body is a rendered projection of `extra.outline[]`; hand-editing the body section-by-section is retired.

1. **Domain detail first** — the full narrative lives in a linked spec, not in the PRD body:
   - New domain → `lore create spec --kind domain-overview --parent <prd>` (full review lifecycle: draft → in-review → approved; fast-track disallowed for this kind).
   - Existing domain → `lore set <domain-doc>` (normal CAS update, targeting the domain spec, never the PRD body).
2. **Bounded outline entry** — `lore outline set <prd> --section <key> --title … --direction … --decision-pointers <adr-slugs> --constraints … --links <domain-doc-slug>:detail …` records the summary + the `rel="detail"` link back to the domain doc. This is the sole dedicated writer for `prd.extra.outline[]`; a direct `lore set` patch touching `extra.outline` is rejected (VALIDATION_ERROR naming `lore outline`).
3. **Landing-spec chain unchanged** — feature/tech/design specs still parent to the PRD and flow into plan/task exactly as before.

⛔ **Never edit the root PRD body wholesale** via `lore set <prd> --content …` — that clobbers the rendered outline projection and reintroduces the 100KB-append-per-round failure mode SPEC-080 retired. Detail belongs in the domain doc; the PRD carries only the bounded outline entry + links.

## Exit Criteria (all modes)

Every mode must satisfy before declaring "done":
1. Output artifact persisted in the lore corpus with correct type and links
2. Cross-cutting concerns checklist passed (see [cross-cutting-concerns.md](references/cross-cutting-concerns.md))
3. Next step recommendation provided (proceed / pivot / park / kill / more research)
4. Assumptions explicitly listed with confidence levels
