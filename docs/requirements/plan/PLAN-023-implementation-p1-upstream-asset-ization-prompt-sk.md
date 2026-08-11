---
id: PLAN-023
type: plan
role: plan
title: "Implementation — P1 upstream asset-ization (prompt/skill sub-types)"
status: archived
priority: high
created: 2026-07-08
updated: 2026-07-26
tags: [p1, implementation]
parent: SPEC-068
phases:
  - {name: "Phase 1 - core sub_type", description: "KNOWLEDGE_SUB_TYPES += prompt/skill + extra schemas"}
  - {name: "Phase 2 - migrate + discovery", description: "seed rule doc → skill(applies_to) + gate applies_to lookup"}
  - {name: "Phase 3 - closed loop", description: "e2e asset discovery + feeding"}
---
Implements spec-upstream-asset-ization-prompt-skill-as-first-class-knowledg. Governance: attended. Invariants: (1) new sub_types don't break existing knowledge validation — full regression each task; (2) seed migration idempotent; (3) gate applies_to lookup backward-compat — slice-1 spec-loop-e2e stays green; (4) deterministic gate exit-code semantics untouched. Risks: R1(H) core schema blast radius→full 673+2890 regression per task; R2(M) missed gate call-site→re-run spec-loop-e2e. Critical path: T1→T2→T3→T4.
