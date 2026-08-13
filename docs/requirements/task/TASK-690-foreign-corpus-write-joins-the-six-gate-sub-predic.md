---
id: TASK-690
type: task
role: plan
title: "foreign_corpus_write joins the six gate sub-predicates and ships enabled by default"
status: archived
priority: medium
phase: "guard"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-128
plan: PLAN-128
---
Lands D4's config half. A seventh .strict() sub-predicate on GateCheckpointConfigSchema plus its resolveForeignCorpusWriteGateEnabled helper, reached through the SAME keyed dispatch as the existing six (config.ts:1240-1363). Ships inside dist/lore's schema default so a bare lore init project is covered with zero config edits and no assets/ sync. AC-CP-4 asserts the default behaviourally, the knob in both directions, and path-identity structurally -- because behaviour alone cannot distinguish a shared path from an ad-hoc resolver.
