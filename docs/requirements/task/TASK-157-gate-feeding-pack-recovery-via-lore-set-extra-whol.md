---
id: TASK-157
type: task
role: plan
title: "gate feeding pack recovery via lore_set extra wholesale-wipes plan.extra.phases"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
REPRO (2026-07-25, this session): plan-promote gate denied approve with feeding pack naming the recovery: set extra {"requires_uat": true} via MCP lore_set (CLI lore set has no flag for it). Followed literally, the write REPLACED extra wholesale — plan-implementation-spec-076-distribution-integration-asset lost its extra.phases (4 phases), discovered only when a later lore create task --phase failed with 'parent plan declares no phases'. Repaired by re-running lore phase add x4 (requires_uat survived).

DEFECT: the feeding pack's literal recovery command is destructive for any doc whose extra carries sibling structured fields (phases/claim/verification_evidence are guarded by dedicated writers, but plan.extra.phases is reachable by lore_set). Options for the fix owner: (a) lore_set extra deep-merge semantics or a dedicated --extra-patch channel; (b) plan-promote feeding pack names a safe dedicated writer (e.g. a lore plan require-uat verb) instead of raw lore_set; (c) CorpusService.set rejects extra patches that would drop phases on a plan (mirror the validity-patch rejection precedent). Oracle for the fix: author→trip e2e — follow the feeding pack recovery on a phased plan, assert phases survive.
