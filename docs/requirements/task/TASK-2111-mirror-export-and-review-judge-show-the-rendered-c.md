---
id: TASK-2111
type: task
role: plan
title: "Mirror export and review judge show the rendered children"
status: draft
priority: medium
phase: "P2 Rendering"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
links:
  - {id: TASK-2077, type: blocks}
---
Covers: AC-CL-2
Approach: export-docs-service.ts appends the section via the literal 'const childrenSection = renderBaselineChildren(doc, children);' (falsifier). CorpusService.getReviewBundle adds a derived part {heading: 'Children (from the tree)', entries} for a baseline root, branch or section (the v9 derived_parts mechanism of the #414 plan; the v9 template is NOT edited). Check that bun run mirror:export output and check:spec-mirror stay consistent.
