---
id: TASK-241
type: task
role: plan
title: "[Skill:test] Settings e2e suites (render + write)"
status: archived
priority: high
phase: "Phase 3: Verification & Acceptance"
created: 2026-07-22
updated: 2026-07-22
tags: []
parent: PLAN-059
plan: PLAN-059
links:
  - {id: TASK-239, type: blocks}
---
Estimate: M
Approach: Playwright, extend packages/dashboard/tests/e2e/ — throwaway corpus via global-setup.ts (NEVER the repo's own .lore/). Mirror write-flow.pw.ts structure.
Source: SPEC-064 Verification; packages/dashboard/tests/e2e/global-setup.ts, write-flow.pw.ts
Dimensions: D-FUNC, D-UX
Covers: AC-064-1, AC-064-2
TDD-Role: authored after T4 (user-selected: e2e follows frontend)

Author two Playwright suites against the Settings route (T4):
- settings-render.pw.ts (AC-064-1): both scopes present; every deny key (incl. defaults.editor) has 0 enabled inputs + the YAML note; the machine-scope blast-radius disclosure text is in the DOM; each defaults.* row shows the 3 layers with exactly 1 marked effective.
- settings-write.pw.ts (AC-064-2): saving sync.enabled reports restart_required = exactly [sync.enabled]; saving workflow.claim_ttl_minutes reports exactly 0 restart entries; a stale base hash opens ConflictModal and leaves the target config file byte-identical.
Use the throwaway-corpus pattern; assert against a temp config file, never the repo corpus.

AC:
- settings-render.pw.ts runs exactly 1 spec file, exits 0: cd packages/dashboard && bunx playwright test tests/e2e/settings-render.pw.ts
- settings-write.pw.ts runs exactly 1 spec file, exits 0: cd packages/dashboard && bunx playwright test tests/e2e/settings-write.pw.ts
- Covers AC-064-1 and AC-064-2 (attested via these e2e runs).
