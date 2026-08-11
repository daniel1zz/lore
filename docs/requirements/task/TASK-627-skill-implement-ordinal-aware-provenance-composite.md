---
id: TASK-627
type: task
role: plan
title: "[Skill:implement] ordinal-aware provenance composite — insertWithAllocatedOrdinalAndProvenance closes BUG-002 window on numbered creates"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PRD-001
---
Assess finding (spec-level): CorpusService._createImpl's numbered path uses a three-await sequence (insertWithAllocatedOrdinal + insertVersion + appendAuditEntry), reintroducing the pre-BUG-002 partial-write window on every spec/adr create. Fix: StoreInterface gains an ordinal-aware provenance composite mirroring insertWithProvenance; route the numbered create path through it; add a store-failure-interleaving test asserting no orphan doc row. Source: knowledge-assessment-implementation-spec-084-corpus-allocated.
