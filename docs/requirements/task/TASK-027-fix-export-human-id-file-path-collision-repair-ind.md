---
id: TASK-027
type: task
role: plan
title: "Fix export human-ID + file-path collision, repair index"
status: archived
priority: critical
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-005
plan: PLAN-005
links:
  - {id: TASK-028, type: blocks}
---
See plan. Fix allocator + path dedupe in export-docs-service.ts; repair existing bad mapping (KN-002 duplicate → second doc gets KN-003 + own file); verify export-docs full clean afterwards.
