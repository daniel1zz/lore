---
id: TASK-200
type: task
role: plan
title: "[Skill:implement] dashboard Issues page + badge + home card + Playwright e2e"
status: archived
priority: critical
phase: "Phase 1: Implementation"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-043
plan: PLAN-043
---
Estimate: L
Approach: dashboard SPA (packages/dashboard, Vite+React+shadcn — follow existing page/nav conventions, SPEC-015/022): (1) nav entry "Issues" with open-count badge (hidden at 0), polling GET /api/issue-reports; (2) Issues page: list (title/reporter_project/reported_at/possible_duplicates count, newest first) + detail view (full extra.issue_report payload + description); (3) in-place Approve and Reject-with-reason buttons composing the EXISTING SPEC-022 cookie adjudication routes (investigate the pending-view approve/reject wiring and reuse; reject reason required — disable submit when empty); (4) home card: open count + ≤3 recent titles, links to Issues page, explicit empty state. Playwright e2e packages/dashboard/tests/e2e/issues.spec.ts following global-setup throwaway-corpus pattern; seed reports by spawning the REAL `dist/lore report-issue` from a twin consumer tmpdir fixture (build first); serialize against the fixed dev-server port; test names embed AC-074-1..4 tokens.
Source: spec-074 §Design; packages/dashboard/tests/e2e/global-setup.ts
Dimensions: D-UI, D-UX
Scope-Alt: possible_duplicates rendering may degrade to a count (no per-id links) without blocking
Covers: AC-074-1, AC-074-2, AC-074-3, AC-074-4

AC: the four spec AC playwright commands (issues.spec.ts -g AC-074-1..4) each exit 0 ≥1 matched; full issues.spec.ts green; existing dashboard e2e suite untouched and green (scoped: run the full playwright e2e once, serialized); bun run typecheck exit 0.
Integration: THIS makes triage user-reachable — nav entry visible on dashboard load.
