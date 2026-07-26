---
id: TASK-240
type: task
role: plan
title: "[Skill:test] regression: existing e2e suites green"
status: archived
priority: medium
phase: "Phase 3: Verification & Acceptance"
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-059
plan: PLAN-059
links:
  - {id: TASK-239, type: blocks}
---
Estimate: S
Approach: run the existing 4 dashboard e2e suites unchanged to prove the new Settings route did not perturb routing/auth/write; then orchestrator-level lore verify + assess.
Source: SPEC-064 AC-064-7; packages/dashboard/tests/e2e/{read-flow,write-flow,browse-ux,review-loop}.pw.ts
Dimensions: D-FUNC
Covers: AC-064-7

Run the pre-existing e2e suites green after the Settings route is added (no new file; this is a regression gate). No source change expected; if the new route perturbs routing/auth, fix is out-of-scope-report back to T4.

AC:
- The 4 existing suites run and exit 0: cd packages/dashboard && bunx playwright test tests/e2e/read-flow.pw.ts tests/e2e/write-flow.pw.ts tests/e2e/browse-ux.pw.ts tests/e2e/review-loop.pw.ts
- Covers AC-064-7.
