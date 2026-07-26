---
id: TASK-161
type: task
role: plan
title: "Fix SPEC-077 T2 client shape drift: PhaseScorecard client types vs real /api/phase-status response (PhaseProgressPanel render TypeError blanks /execution)"
status: archived
priority: high
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
T3 e2e (execution.pw.ts, correct and merged) empirically caught a T1/T2 parallel-wave shape drift: client PhaseScorecard/PhaseChecklistItemView in api.ts were authored ahead of T1's real route and never reconciled. Real server response (curl-verified by T3 against seeded corpus; SSOT = PhaseWorkflowService.planPhaseStatus in packages/lore/src/service/phase-workflow-service.ts): per-phase uses phase_title (not name), checklist is a counts object with items in checklist_items[] carrying field trust (not trust_label), and there is NO dropped_item_names field (dropped items are checklist_items entries with the dropped state). PhaseProgressPanel.tsx:87 reads phase.dropped_item_names.length unconditionally -> TypeError on every real phase render -> no error boundary -> whole /execution page blanks. Fix: read the REAL interface from phase-workflow-service.ts and mirror it exactly in api.ts client types; update PhaseProgressPanel to render phase_title, counts, checklist_items[].trust labels verbatim, dropped names derived from dropped-state items; update PhaseProgressPanel.test.tsx fixtures to the real shape (red-first: current fixtures assert the wrong shape); remove the now-fixed KNOWN LIVE DEFECT paragraph from packages/dashboard/CLAUDE.md. AC: (1) AC-077-3 command green against real-shape fixtures; (2) AC-077-5 command (execution.pw.ts, DO NOT EDIT the e2e suite) green; (3) bun run typecheck green.
