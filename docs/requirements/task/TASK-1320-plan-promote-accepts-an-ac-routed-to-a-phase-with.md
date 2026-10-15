---
id: TASK-1320
type: task
role: plan
title: "plan-promote accepts an AC routed to a phase with zero tasks, so lore verify has no task to attest it on"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"planning","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"a8ab3b8e-2a4b-40cf-aad4-391f821251e6"}
---

A spec AC assigned in a plan to a phase that holds no task has no possible evidence owner: lore verify refuses to attest it without a claimed task whose ac_scope includes it, and plan-promote does not catch this at planning time.

**Expected:** A plan whose wave table assigns a spec AC (here AC-RS-14) to a phase must have at least one task in that phase whose ac_scope claims it, or plan-promote refuses; lore verify can then attest the AC without new planning.
**Actual:** plan-rule-store-option-a routes AC-RS-14 to phase 'close' (0 tasks). lore verify --ac AC-RS-14 exits 4 ('no task in this plan has a fresh claim'); --task <T13> exits 4 (AC outside its ac_scope). The only path was creating a new close-phase task mid-close (task-rule-store-close-user-layer-migration-and-ac-rs-14). The plan reached 13/13 archived with AC-RS-14 having no possible owner.

Reported by: agent:session-3f2e7715
