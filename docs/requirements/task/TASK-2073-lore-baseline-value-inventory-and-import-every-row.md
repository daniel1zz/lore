---
id: TASK-2073
type: task
role: plan
title: "lore baseline value inventory and import: every row accounted, revisions staged, wrong values printed"
status: deprecated
priority: medium
phase: "P4 Retired drafts (deprecated, no work)"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
---
Covers: AC-CV-5
Approach: the spec's Migration section. inventory --json and --count read live baseline bodies with CURRENT_VALUES_HEADING (literal 'const CURRENT_VALUES_HEADING = /^#{2,4}\s+Current values\s*$/im;', the AC-CV-7 falsifier). import refuses unaccounted rows with the literal 'if (unaccounted.length > 0) return refuseImport(' (falsifier), writes bindings, stages one pending body revision per node and the root conventions sentence, prints each written value that differs from the value in effect; idempotent.
