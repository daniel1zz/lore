---
id: TASK-177
type: task
role: plan
title: "[Skill:implement] T8b wire setup.check_reminder into check-cache write + hook suppression"
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
Estimate: S
Approach: Wire resolveSetupCheckReminderEnabled (packages/core/src/config.ts, landed by T8) into setup-check.ts's cache-write path: when the resolved team/machine config yields check_reminder=false, the written SetupCheckCache carries reminder_enabled:false; hook Phase F (already landed) reads cache-only, so suppression flows through without the hook parsing yaml. Update hook to honor cache.reminder_enabled===false as silent (additive field read, fail-open on absence).
Source: T8 completion report Scope-Alt debt — "recommend a small follow-up task to wire resolveSetupCheckReminderEnabled into setup-check.ts's cache-write path once it's free"
Dimensions: D-FUNC
Scope-Alt: none (this IS the descoped remainder of T8)
Covers: AC-076-7 (config-knob leg)

AC:
- Given .lore/config.yaml (or machine config) with setup.check_reminder: false, When `lore setup --check` writes the cache, Then the cache JSON carries reminder_enabled: false
- Given a cache with reminder_enabled: false and status="stale", When the hook Phase F runs, Then advisory output = 0 bytes (suppressed), and with reminder_enabled absent (legacy cache) behavior is byte-identical to pre-change (fail-open regression)
- bunx vitest run packages/lore/tests/unit/hooks/session-start-freshness.test.ts green with ≥2 new cases; typecheck 0; embed-assets-manifest --check exit 0 (hook edit → regeneration obligation)
