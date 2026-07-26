---
id: TASK-290
type: task
role: plan
title: "[Skill:verify] repo-wide regression gate (typecheck + both runners)"
status: archived
priority: high
phase: "Phase 3: Regression & verification"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
---
Estimate: S
Approach: Final DoD gate. Run repo-wide `bun run typecheck && bun run test` (both vitest + bun
runners) and confirm GREEN with all Phase-1/2 code merged. Also assert INV-7: root `package.json`
still declares `"private": true` (a publish-focused stream must never flip it). Fix any
cross-cutting regression that surfaces (regressions belong to whichever module introduced them —
route back if substantial). Then confirm attested evidence exists for every script AC via
`lore verify <plan>`.
Source: SPEC-048 AC-048-D; plan INV-7; DoD in plan skill SKILL.md.
Dimensions: D-CODE (regression integrity)
Scope-Alt: none — this is the completion gate.
Covers: AC-048-D
Blocked by: T6 (final integration must be green first; transitively covers T1-T5).

AC:
- Integration: Given all Phase-1/2 tasks merged to the working tree,
  When `bun run typecheck` runs,
  Then it exits 0 (all packages + scripts clean).
- Integration: Given the same tree,
  When `bun run test` runs (test:vitest then test:bun),
  Then both runners exit 0 — including the new distribution unit suites, the integration sim,
  AND the pre-existing assets-ssot.test.ts (unchanged, proving INV-5/INV-6 held).
- Integration (INV-7): Given the repo root `package.json`,
  When its `private` field is read (e.g. `node -e` / grep assertion, or a checked assertion in
  the regression run),
  Then `private === true` — the workspace root was NOT flipped publishable during this stream.
- Oracle: `bun run typecheck && bun run test` exit 0 (attested via `lore verify`); INV-7 assertion exit 0.
