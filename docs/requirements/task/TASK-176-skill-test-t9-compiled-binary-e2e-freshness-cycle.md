---
id: TASK-176
type: task
role: plan
title: "[Skill:test] T9 compiled-binary e2e freshness cycle"
status: archived
priority: high
phase: "Phase 4: Verification"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-175, type: blocks}
---
Estimate: M
Source: AC-076-10 statement (spec) — compiled-binary end-to-end cycle
Covers: AC-076-10
TDD-Role: e2e (post-impl by design — exercises the real binary)

Scenarios (single bun.test file, temp dir target, spawns dist/lore):
- fresh `lore setup --yes --claude-dir <tmp>` → `--check` exit 0
- mutate one managed file → `--check` exit 3, --json files.diverged contains exactly that path
- `lore setup --yes --force-diverged` → file restored (sha equals embedded), backup exists → `--check` exit 0
- binary freshness guard: bun run build precedes spawn (SPEC-061 lesson — stale dist/lore is a false oracle)

AC:
- cd packages/lore && bun test tests/e2e/setup-freshness-cycle.bun.test.ts exits 0, ≥3 cases passed (matched-count asserted)
- Test never touches the repo's own .lore/ or ~/.claude (throwaway --claude-dir only; global-setup pattern)
