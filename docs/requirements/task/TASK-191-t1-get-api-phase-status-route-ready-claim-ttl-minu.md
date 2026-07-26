---
id: TASK-191
type: task
role: plan
title: "T1 — GET /api/phase-status route + ready claim_ttl_minutes enrichment (AC-077-4)"
status: archived
priority: high
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-041
plan: PLAN-041
links:
  - {id: TASK-189, type: blocks}
---
Implement SPEC-077 S3+S4: new read route GET /api/phase-status/:planIdOrSlug (cookie OR bearer; 200 pinned {plan:{id,slug,title},phases:PhaseScorecard[]} from the PhaseWorkflowService status projection with zero route-side derivation; plan without phases -> 200 phases:[]; unknown -> 404 DOC_NOT_FOUND; non-plan doc -> 422 VALIDATION_ERROR naming actual type) and additive top-level claim_ttl_minutes on GET /api/ready/:planIdOrSlug (resolved workflow.claim_ttl_minutes, HTTP-layer enrichment, core ReadyReport untouched). Oracle: AC-077-4 command. Also update packages/lore/src/adapters/http/CLAUDE.md route table.
