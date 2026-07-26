---
id: TASK-182
type: task
role: plan
title: "[Skill:implement] T5 converge hardening: diverged-skip / --force-diverged / manifest stamping"
status: archived
priority: critical
phase: "Phase 2: Core freshness logic"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-179, type: blocks}
  - {id: TASK-176, type: blocks}
  - {id: TASK-177, type: blocks}
---
Estimate: L
Approach: setup-service.ts consumes UpdatePlan when an installed manifest exists (planUpdate path) while fresh install keeps planInstall unchanged (Domain: different invariants, two pure planners). Diverged → skipped + collected into receipt with per-file repair command (`lore setup --force-diverged` global flag, declared in commands/setup.ts); --force-diverged → backup then overwrite. Missing → rewrite. Manifest write (LAST, unchanged discipline) now stamps binary_version (embedded const), installed_at (ISO now), assets_digest (embedded tree_digest), per-entry ownership. Successful converge deletes the check cache. Receipt extends with skipped-diverged section.
Source: SPEC-076 §C3 §C4 §C7 D2; Downstream Handoff UpdatePlan
Dimensions: D-FUNC, D-CODE
Scope-Alt: receipt formatting minimal (path + one repair line each); no colorization
Covers: AC-076-3, AC-076-6

AC:
- Given a user-modified managed file, When `lore setup --yes` re-runs, Then the file's bytes are unchanged, exit is 0, and stdout lists the path + literal repair command (D2)
- Given same state, When `lore setup --yes --force-diverged` runs, Then the file's sha256 equals the embedded sha and a backup of the user version exists under .lore-backups
- Given converge success, Then manifest binary_version = LORE_BINARY_VERSION, assets_digest = embedded tree_digest, installed_at parses ISO8601, and the check cache file is absent
- Given two consecutive converges with no changes, Then the second issues zero writer calls (I2 regression, existing test extended)
- Integration: cd packages/lore && bun test tests/integration/setup-converge-diverged.bun.test.ts tests/integration/setup-manifest-fields.bun.test.ts green (authored in-task red-then-green)
