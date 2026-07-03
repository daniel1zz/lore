---
id: TASK-034
type: task
role: plan
title: "Fix write-path bugs: cross-doc edit leak, transition If-Match, draft timer (AC-DH-1/2/3)"
status: archived
priority: critical
phase: hardening
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, bugfix]
parent: PLAN-006
plan: PLAN-006
links:
  - {id: TASK-030, type: blocks}
  - {id: TASK-031, type: blocks}
---
Files: packages/dashboard/src/routes/docs.$id.tsx (add key={doc.id} at :77), packages/dashboard/src/components/DocDetail.tsx (handleTransition :212 pass version; Save/Cancel clearTimeout draftSaveTimerRef), StatusPill.tsx if transition wiring requires. Add regression tests for all three (cached A→B navigation state leak; stale transition gets 409 not silent overwrite; canceled draft does not resurrect). Oracles: typecheck + vitest.
