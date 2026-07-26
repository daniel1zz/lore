---
id: TASK-178
type: task
role: plan
title: "[Skill:implement] T8 session-start hook Phase F cache-first advisory + config knob"
status: archived
priority: medium
phase: "Phase 3: Peripherals"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-175, type: blocks}
---
Estimate: M
Approach: session-start-resume.mjs gains Phase F AFTER existing phases (never reorders them): read check cache JSON; fresh(<24h)+sync → nothing; fresh+stale → inject exactly one advisory line naming binary vs installed version + `lore setup`; missing/expired → spawn detached+unref `lore setup --check --json` fire-and-forget (writes cache for next session), inject nothing this session. Entire phase wrapped in try/catch → silence (I6 fail-open). Kill-switches: env LORE_SETUP_NO_CHECK=1 skips phase entirely; config setup.check_reminder:false (read from .lore/config.yaml if cheaply reachable in hook context — if not reachable without heavy parse, env-only and config knob enforced CLI-side at cache-write time, document which). Config schema: setup.check_reminder boolean default true in packages/core/src/config.ts.
Source: SPEC-076 §C6 D4 D5; R2 mitigation
Dimensions: D-FUNC, D-CODE
Scope-Alt: config-knob read in hook may delegate to cache content (CLI writes reminder_enabled into cache) — document if taken
Covers: AC-076-7

AC:
- Given cache status="sync" fresh, When hook runs, Then advisory output = 0 bytes and 0 child processes spawned
- Given cache status="stale" fresh, Then exactly 1 advisory line (assert count) and 0 child processes
- Given LORE_SETUP_NO_CHECK=1, Then 0 bytes output and 0 spawns regardless of cache state
- Given missing/expired cache, Then hook exits without waiting (elapsed <100ms in test) and a detached child later produces a valid cache file observable by a second invocation (R2 oracle, real subprocess)
- Given corrupted cache JSON, Then silence + no crash (ERROR dim)
- Integration: bunx vitest run packages/lore/tests/unit/hooks/session-start-freshness.test.ts green (authored in-task red-then-green); hook file syntax-valid under plain node (existing hook-test harness pattern)
