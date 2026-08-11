---
id: TASK-635
type: task
role: plan
title: "[Skill:test] T7 compiled-binary e2e: migrate ordinals dry-run/apply/idempotency"
status: archived
priority: high
phase: "Phase 3: Verification + live repair"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
links:
  - {id: TASK-641, type: blocks}
---
Estimate: M
Source: AC-084-5; SPEC-080's bootstrap-injection-compiled.bun.test.ts + slugify-compiled.bun.test.ts as the compiled-e2e pattern; throwaway-corpus discipline (mkdtemp, NEVER the repo .lore/)
TDD-Role: verification authoring (compiled-binary red-first rejected — per-cycle rebuild cost, plan Decisions Log)
Dimensions: D-FUNC
Scope-Alt: none — sole attested oracle for AC-084-5
Covers: AC-084-5

Scenarios (all against fresh-built dist/lore on a seeded throwaway corpus):
- Seed docs whose titles self-declare conflicting numbers via DIRECT sqlite writes into the copy (simulating the legacy state — the new schema guard forbids creating them through the CLI, which is itself asserted: `dist/lore create spec --title "SPEC-99 — x" ...` → exit 4 VALIDATION_ERROR).
- `dist/lore migrate ordinals` (no flag) → exit 0, prints mapping report + set-equality invariants, corpus copy byte-unchanged (dry-run proof: hash the db before/after).
- `dist/lore migrate ordinals --apply` → converged: zero duplicate (type,ordinal); titles prose-pure; `dist/lore get SPEC-<n>` resolves each renumbered doc; export-index human_ids read from columns.
- Second `--apply` run → mapping report empty, zero writes (idempotency).
- New create after migration → next-free ordinal allocated automatically; display composed.

AC:
- `cd packages/lore && bun test tests/e2e/migrate-ordinals-compiled.bun.test.ts` GREEN with >0 executed tests; suite asserts corpus path outside the repo; `bun run build` freshness inside beforeAll.
