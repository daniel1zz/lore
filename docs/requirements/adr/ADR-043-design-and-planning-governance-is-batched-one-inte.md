---
id: ADR-043
type: adr
role: decision
title: "Design and planning governance is batched: one interview, one production run, one bundle review, one approval"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
# Context

Design and planning ran governance per artifact: one slice cost 5-6 user stops (PRD key decisions, PRD approval, design approval, plan clarification sprint, plan strategy pick, task-tree confirmation) plus one per phase transition under the default `attended` governance_mode, and every edit to an approved doc re-armed a review. The owner observed a requirement built through the workflow costs at least twice the time and tokens of building it without, without measured quality gain. Two measured retros show the per-artifact placement is also the weaker one: per-doc review cannot see cross-document contradictions (knowledge-gates-and-the-review-judge-validate-a-spec-against: three contradictions with an approved spec passed every gate and repeated per-doc review, caught only by an implementer's tests), and per-doc re-review loops multiply (knowledge-redeeming-three-advisories-produced-two-more-rounds: v19 to v33, seven rounds, zero code).

# Decision

One governance flow, no modes (owner instruction 2026-10-08: "应该就一个模式，不要分"): S1 one decision interview collecting every user question from product, design and plan at once, with measurement-dependent decisions written as pre-registered branches; S2 uninterrupted production of the whole initiative (every slice's spec, every AC, every plan and task) as drafts; S3 one review over the whole bundle (all lenses in parallel, each reading the full bundle, max 2 rounds) then exactly one `lore review` per judgment-required doc on its final version; S4 one user approval, then `lore approve` in dependency order. Execution auto-proceeds through phase gates; the user is consulted only for results outside every pre-registered branch, autopilot M1-M5, or an unfixable invariant violation. `lore assess` runs once per plan, batched at the end of the initiative (a pre-registered pilot plan is assessed when it closes).

SSOT: assets/skills/shared/batched-governance.md. Consumers: lore-product (mode-prd 1A/1C/2/3.5), lore-design and lore-design-ui (approval gates removed), lore-plan (SKILL rule 7, mode-create 1.2/1.3/1.4/8.3/8.6/8.7, mode-update 7, mode-replan 3 and 8, plan-file-format, workflow-examples), lore-autopilot (Phase 5 assess). The `governance_mode: attended | unattended` plan field is retired; plan content gains a Pre-registered Branches table.

# Consequences

- Binary gates are unchanged: approve still needs a per-version judgment for spec and adr (`workflow.review.judgment_required_types`); batching only places that one call after the final edit. ACs must be final before S3 because `lore ac set` voids the judgment.
- Not enforced by any mechanism: nothing refuses a per-artifact stop or a mid-run `lore approve`; the flow is prose in skills. A mechanism would be a check that approvals of one initiative's docs happen in one batch.
- Unmeasured: whether batching keeps quality. Falsifier: over the next initiatives, compare tokens, wall time and defects found within two weeks after merge against the pre-change initiatives; if defects rise while cost falls little, revisit.
- Risk: an S1 interview that misses a preference question pushes that decision to the AI in S2; it surfaces in S4 as an AI-made decision rather than as a mid-run stop.
