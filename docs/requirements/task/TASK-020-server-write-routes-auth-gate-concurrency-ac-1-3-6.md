---
id: TASK-020
type: task
role: plan
title: "Server write routes + auth gate + concurrency (AC 1-3,6,7,9 + TEL-1)"
status: archived
priority: high
phase: server-api
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-002
plan: PLAN-002
---
Implement SPEC-022 §9.1/§9.3/§9.4: NEW dashboard-routes.ts (6 handlers), NEW concurrency.ts (checkIfMatch → 409 {current,mine,diff}), auth.ts requireCookieSession (401 no session / 403 bearer), routes.ts wiring under /api/dashboard/, telemetry source:'dashboard' discriminator in @lore/core event schema. All mutations via CorpusService/ReviewService only. Force overwrite: X-Force-Overwrite:1 + no If-Match, audit records force:true.
