---
id: TASK-617
type: task
role: plan
title: "[Skill:implement] governance verb topic registry (corpus-workflow|seat-briefing|claude-md)"
status: archived
priority: medium
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-606, type: blocks}
---
Estimate: M
Approach: per spec D6 — refactor commands/governance.ts to positional-topic registry map {corpus-workflow (default) | seat-briefing | claude-md} → asset path; existing --seat-briefing (SPEC-085) becomes deprecated alias (stderr warning once); >1 topic resolved → exit 2 via SPEC-051 strict seam. Asset resolution stays on resolveBinPath/resolveAssetsRoot (SPEC-083). Preserve exit-4-on-unreadable + never-silent-empty contract byte-for-byte for existing topics.
Source: spec §D6; SPEC-083/085 as-built (lore get spec slugs)
Dimensions: D-CODE, D-FUNC
Scope-Alt: flag aliases can keep silent (no deprecation line) if stderr noise is contested — registry + exit 2 are non-negotiable
Covers: AC-CMC-2

AC:
- Given the paired RED e2e suite, When implementation lands and `bun run build` refreshes dist/lore, Then `cd packages/lore && bun test tests/e2e/governance-claude-md-compiled.bun.test.ts` GREEN
- Given existing governance regression suites, When `cd packages/lore && bun test tests/integration/governance-compiled.bun.test.ts` and `bunx vitest run packages/lore/tests/unit/setup-governance-retirement.test.ts` run, Then GREEN unchanged (corpus-workflow default + seat-briefing behavior + retirement SSOT byte-preserved)
- Integration: session-start hook Phases C/D continue to work — hook spawn contract unchanged (spawns same CLI forms)
