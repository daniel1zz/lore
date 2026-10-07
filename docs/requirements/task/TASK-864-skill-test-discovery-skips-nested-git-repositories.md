---
id: TASK-864
type: task
role: plan
title: "[Skill:test] discovery skips nested git repositories — RED"
status: archived
priority: critical
phase: "Phase 3: Dogfood & verify"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
---
Estimate: S
Source: spec AC-STR-10; issue #24 (measured: untracked nested repo everything-workspace/ linted as a module)
TDD-Role: red | Paired-Impl: nested-repo probe task
Covers: AC-STR-10

Scenarios (vitest, mkdtemp git repo, config-only .lore with adoption: enforce, run lore from source; never this repo):
- root CLAUDE.md conforming; `vendor/other/.git/` (directory) + `vendor/other/CLAUDE.md` of 400 lines → `--check-claude-md --json`: no finding/advisory path starts with `vendor/other/`; exit EXACTLY 0.
- same with `.git` as a FILE (`gitdir: ...`, submodule shape) → same result.
- control: `pkg/CLAUDE.md` (ordinary subdir, no .git) of 400 lines → IS reported (max_lines, path `pkg/CLAUDE.md`), exit 3.
- the root's own `.git` never stops the walk (root files still discovered).

AC:
- RED on current main; record `--result expected-fail --capture --ac AC-STR-10` at red.
