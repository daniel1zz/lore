---
id: TASK-054
type: task
role: plan
title: "F3 triage queue + doc-detail audit tab + adjudication UI"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-013
plan: PLAN-013
---
SPEC-033 §2.3/§2.4-audit-tab. Pending page: judgment badge column (import components/judgment-badge.tsx from F2), escalated-only filter, expandable blocking_questions, inline approve/reject w/ optional calibration note (mutations already support calibrationNote+warnings — F1), warnings toast on partial failure, If-Match preserved. Doc detail: Audit tab — trail w/ parseAuditActor decoding (@lore/core browser-safe), judge identity badge + judgment link. Dashboard vitest. Anchors: pending page + doc-detail page + their components; do NOT touch home (F2 owns it).
