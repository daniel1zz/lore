---
id: TASK-030
type: task
role: plan
title: "Dashboard delete + restore surface, cookie routes + UI + tests (AC-DH-6/7)"
status: archived
priority: high
phase: surface
created: 2026-07-03
updated: 2026-07-03
tags: [spec-027, feature]
parent: PLAN-006
plan: PLAN-006
links:
  - {id: TASK-029, type: blocks}
---
Backend: add cookie-authed DELETE doc + POST restore routes in packages/lore/src/adapters/http/dashboard-routes.ts following assertCookieActor + telemetry source=dashboard pattern. Frontend: delete entry w/ confirmation in DocDetail.tsx (navigate away after), Restore button per version in HistoryTab.tsx (append-only semantics). Owns HistoryTab component tests incl. restore. Extend mutations.ts + e2e write-flow. Oracles: typecheck + vitest + playwright.
