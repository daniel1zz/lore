---
id: KN-019
type: knowledge
role: knowledge
title: "Lore as sole dev context — output contract + spec_kind taxonomy + dashboard-as-PRD-projection"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-08
tags: [output-contract, taxonomy, dashboard, ssot, ideation]
parent: PRD-001
links:
  - {id: PRD-001, type: informs}
---
# Ideation: Lore as sole dev context — output contract + type taxonomy + dashboard-as-PRD-projection

> Status: analysis complete, awaiting owner decision on two points (taxonomy option, launch order).
> Origin: 2026-07-03 discussion after the dashboard review/fix cycle (SPEC-031) exposed that design artifacts have no home in the corpus.

## Thesis

Lore should be the single source of context for the whole dev system: every lifecycle stage has a REQUIRED output, standardized in the corpus, and the dashboard is the visual projection of that corpus (product's current shape, iteration history, key decisions). This requires an explicit **output contract** — without one, standardization relies on discipline and drifts (proof: the dashboard UI was built with no design stage; corpus has zero design docs).

## Decision 1 — Where do design outputs live? (recommend C)

- **A. New first-class `design` type**: cleanest semantics, but full-stack change (Zod superRefine, 22 CLI commands, 16 MCP tools, dashboard type-dispatch, migration). Largest error surface; hard to reverse if design turns out 95% spec-shaped.
- **B. `knowledge` sub_type `design`**: smallest diff but semantically wrong — design is a *normative contract* (reviewed, approved-gated, implementation must conform), not process residue. Would drown among retros/assessments.
- **C. `spec` gains `extra.spec_kind: feature | tech | design`** ← recommended. Design specs ARE specs: normative, reviewable, plan-driving. Reuses all spec infrastructure (PRD mount requirement, review flow, pending queue, tree contract). Backward compatible (existing specs default `feature`). Continues the v1 DocMan feature-spec/tech-spec convention. Reversible: kind is data, can be promoted to a first-class type later without loss.
- Prototype HTML/screenshots: repo artifacts under `docs/design/`, referenced by relative path from the spec (export-docs already treats `docs/` as the projection domain). Dashboard iframe preview = P2.

## Decision 2 — Output contract (stage → required output → completion gate)

| Stage | Output | Mount | Done means |
|---|---|---|---|
| Direction | PRD version bump | root | PRD approved |
| Feature definition | spec (kind=feature) | PRD | approved |
| UI/UX design | spec (kind=design) + repo prototype artifact | PRD, `relates` to feature spec | approved |
| Tech decision | adr (+ spec kind=tech if needed) | prd/spec | accepted |
| Execution | plan → tasks + SPEC-025 evidence | spec → plan | tasks archived |
| Closeout | SPEC-026 assessment + retro knowledge | plan | assess verdict persisted |

Enforcement layers (two already designed in the corpus tech-spec "Tree Consistency Guarantees", unimplemented):
1. Create-time hard gate: `PARENT_TYPE_CONTRACT`
2. Check-time soft gate: `lore.tree.yaml` blueprint + `lore status --check-tree`
3. Process gate: stage complete ⇔ doc reaches `approved`

The contract itself must live IN the PRD (living root), not in CLAUDE.md — otherwise the "Lore is the sole context" claim is self-contradictory. CLAUDE.md narrows to code-adjacent technical navigation (atomically co-evolving with code, referencing lore slugs).

## Decision 3 — Dashboard shows current shape / iteration / decisions

No new invention needed: SPEC-004 MDX placeholders (ChildrenOf / RecentDecisions / ActivePlans / HealthStats) + existing `GET /api/docs/:id?resolveMdx=true` ARE the mechanism. The correct dashboard home is the **resolveMdx-rendered living PRD**, plus pending-review and ready-tasks aggregation panels. This reframes the review's P1 "cockpit" from new feature → surfacing existing machinery.

## Launch path (dependency order, pending owner sign-off)

1. `/product`: PRD update — output-contract section + spec_kind taxonomy + "dashboard = PRD projection" positioning
2. `/design`: SPEC-032 (spec_kind + contract hard gates, schedules PARENT_TYPE_CONTRACT implementation) + SPEC-033 (dashboard home = resolved PRD + panels)
3. SPEC-033 UI goes through `/design-ui` producing the first dogfooded design spec + prototype

## Open decisions for owner

1. Taxonomy: C (recommended) / A / B
2. Launch order: full chain by dependency (recommended) / dashboard-home first / PRD-contract-only this round
