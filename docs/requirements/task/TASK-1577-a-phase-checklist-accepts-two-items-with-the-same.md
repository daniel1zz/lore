---
id: TASK-1577
type: task
role: plan
title: "A phase checklist accepts two items with the same id; drop/check/edit then act on the first only"
status: draft
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-198
plan: PLAN-198
---
Found 2026-10-18 by the baseline restoration P2 excavation: phase-checklist-service.ts:112-117 and :172 — duplicate checklist ids are accepted on add; later drop, check and edit address only the first match, so the second can never be satisfied or dropped. Expected: a duplicate id refused at add (exit 4).
