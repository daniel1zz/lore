---
id: TASK-2080
type: task
role: plan
title: "lore baseline children migrate stages parent revisions; template and root guide updated"
status: deprecated
priority: medium
phase: "P3 Refusal and change batch"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
---
Covers: AC-CL-4
Approach: the spec's Migration section; writes only through the baseline pending-revision path (never in place); idempotent via the literal 'if (computed === node.content || computed === pendingBody) continue;' (falsifier). branch.md loses its Children table and says children are rendered from the tree; SKILL.md's node table says a branch carries no children list. Shipped assets change, so verify from a fresh consumer install (lore setup into a temporary HOME) that the template has no Children heading.
