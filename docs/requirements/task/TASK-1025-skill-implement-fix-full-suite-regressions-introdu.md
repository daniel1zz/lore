---
id: TASK-1025
type: task
role: plan
title: "[Skill:implement] Fix full-suite regressions introduced by run-identity slice 1"
status: archived
priority: critical
phase: "P6 Verification and close"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
---
Estimate: M
Approach: per the triage below (orchestrator, 2026-10-11, full suites on main vs the same files on baseline 02f8354e in a throwaway worktree)
Source: full-suite run on main after the last merge of plan-run-identity-slice-1-harness-attested-runs
Covers: none new — restores previously green tests (REGRESSION dimension); the slice's ACs stay attested

Regressions introduced by this plan (green on 02f8354e, red on main):
1. Deprecation line on stderr when a test fixture sets LORE_ACTOR (10 tests): tests/e2e/baseline-rollback.bun.test.ts (1), tests/e2e/baseline-slice2-rollback.bun.test.ts (4), tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts (1), tests/unit/adapters/report-issue-hint.bun.test.ts (3), tests/unit/adapters/report-issue-single-remedy.bun.test.ts (1). The warning is spec-mandated (BR-1033); fix the fixtures to name the writer with --by or CLAUDE_CODE_SESSION_ID instead of LORE_ACTOR — never suppress the warning, never weaken a byte-identity assertion.
2. tests/unit/adapters/sync-push.bun.test.ts: its remote fixture migration chain stops at 015 (local user_version 16) — add migration 016 the way the fixture applies the others.
3. packages/lore/tests/e2e/libsql-lazy-load.test.ts AC-LL-10 (2 tests): the new createApp call site(s) from the MCP task (App.forWriteContext / createAppUnscoped in app.ts) must be single-argument or provably sync-stripped as the source-scan pin defines — fix the call site, not the pin.
4. packages/lore/tests/unit/core/issue-report.test.ts "LATEST_SCHEMA_VERSION equals … the highest migration number in sqlite-store.ts's runMigrations chain": the 016 block's shape no longer matches the test's scan — make the chain readable to the scan (or the scan robust to the two-phase 016 block) so both say 16.
Not regressions (also red on 02f8354e or environmental): setup.test second dry-run, anchor-coverage ratchet/stale-exemption, claude-md-eviction-floor advisory band, check-shipped-defaults, mirror-status-parity, spec-mirror-export, setup-manifest-fields, github-intake-reach, spec-loop-e2e (repo-pollution guard: main has other sessions' uncommitted corpus files).

AC:
- Given each file in items 1–4, When run with `env -u LORE_ACTOR -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID` (bun files: `cd packages/lore && bun test --timeout 180000 <file>`; vitest files: `bunx vitest run <file>`), Then each exits 0.
- Given `bun run typecheck`, Then exit 0.
