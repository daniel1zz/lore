---
id: TASK-2011
type: task
role: plan
title: "One-time back-fill: landing kind and claim start_head, then required fields"
status: archived
priority: critical
phase: "P2 Landing predicate"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-250
plan: PLAN-250
links:
  - {id: TASK-2010, type: blocks}
---
Covers: AC-ND-7
Resolves: #422 (a claim without base_sha gets a start_head, so its landing is measurable).
Approach: landing-backfill.ts is the pure transform called by the next numbered migration (take the number at implementation time; the evaluation plans also add migrations, so re-check schema-version.ts after rebasing). Kind-less landings get kind 'commits'; open branch claims without start_head get merge-base(main, tip): tip = ref tip, or for a gone branch the newest evidence head_sha after the claim (also stored as end_tip); a legacy claim with neither is RELEASED with one audit entry (no start or tip recordable; claim again on a branch), never given a default. Afterwards the schema REQUIRES kind on landings and a sha start_head on open branch claims (no unmeasured variant). Idempotent; runs under the migration lock.
