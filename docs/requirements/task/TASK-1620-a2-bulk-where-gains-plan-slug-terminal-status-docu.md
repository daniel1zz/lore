---
id: TASK-1620
type: task
role: plan
title: "A2 bulk --where gains plan=<slug>; terminal-status documents are never candidates"
status: archived
priority: medium
phase: "A"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Found while using lore bulk for the phase-E cleanup: (1) --where has no plan key (unknown where key 'plan'), so deprecating a plan's tasks needed a hand-collected id list; add plan=<id|slug> selecting the plan's tasks. (2) bulk close --where type=plan,open-tasks=0 listed 41 already archived/deprecated plans as candidates; a document already in a terminal status (archived, deprecated) is never a candidate for any verb. Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones Part A. Add tests to bulk-lifecycle.test.ts under the 'preview then apply' describe.
