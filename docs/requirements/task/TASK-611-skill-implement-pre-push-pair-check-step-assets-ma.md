---
id: TASK-611
type: task
role: plan
title: "[Skill:implement] pre-push pair check step + assets-manifest regeneration (convergence)"
status: archived
priority: critical
phase: "Phase 3: Convergence & Verification"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-606, type: blocks}
---
Estimate: M
Approach: append the check step to hooks/pre-push AND assets/project/pre-push identically (fail-open preamble + --no-verify semantics unchanged; own exit handling naming the repair `lore governance claude-md` — mirror the SPEC-081 G5 audit-verify step shape). Then regenerate the embedded assets manifest (`node scripts/embed-assets-manifest.mjs`) covering ALL asset edits from this plan (contract asset, template, SKILL.md, pre-push) and confirm `--check` exit 0.
Source: spec §Scope consumer 3; SPEC-081 G5 step precedent; SPEC-076 manifest mechanics
Dimensions: D-CODE, D-FUNC
Scope-Alt: none — parity + manifest freshness are invariants
Covers: AC-CMC-3, AC-CMC-4

AC:
- Given the paired RED suites, When the step lands, Then `cd packages/lore && bun test tests/integration/pre-push-claude-md-trip.bun.test.ts` GREEN and `bunx vitest run packages/lore/tests/unit/assets/pre-push-parity.test.ts && node scripts/embed-assets-manifest.mjs --check` GREEN/exit 0
- Given this repo itself, When `git push` dry-runs the hook chain, Then existing three checks + new check all execute and pass (repo under ceilings)
- Integration: `lore setup --check` classifies the updated assets as outdated-not-diverged on a stale install (manifest regen correct)
