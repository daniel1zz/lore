---
id: TASK-2085
type: task
role: plan
title: "Evidence check applies only to archived tasks"
status: deprecated
priority: high
phase: "P2 Fix and close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-265
plan: PLAN-265
links:
  - {id: TASK-2084, type: blocks}
---
Covers: AC-EC-1, AC-EC-2
Approach: the spec's status table; the literal 'if (doc.status !== "archived") return { check: "evidence_completeness", outcome: "skipped"' appears verbatim once (falsifier). The detail names the status. Scoped-oracle floor: every importer of review-checks.ts (review service, gate advisory, milestone review inputs) by bun run test:changed plus hand-picked importers.
