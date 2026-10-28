---
id: TASK-2069
type: task
role: plan
title: "Migrate plan legacy phase keys away and drop them from the schema"
status: draft
priority: medium
phase: "P2 Classification"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-264
plan: PLAN-264
links:
  - {id: TASK-2116, type: blocks}
---
Covers: AC-JV-8
Approach: plan-legacy-phase.ts (called by the next numbered migration; take the number at implementation time) moves any plan phase / legacy_phase value, and any phase-document legacy_phase value, into that document's body as 'Legacy phase: ${value}' (falsifier literal) in one audited version and removes the key; idempotent. Then planExtraSchema drops both keys, phaseExtraSchema drops legacy_phase, and lore migrate phases is retired (its subcommand removed; a call exits 2 naming the store migration). 0 of 262 plans carried either key and the corpus held 0 phase documents on 2026-10-26, so this corpus changes nothing; consumer corpora are covered by the migration.
