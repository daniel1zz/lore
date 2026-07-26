---
id: PLAN-067
type: plan
role: plan
title: "Implementation — SPEC-059 requirement-layer quantifiability lint"
status: approved
priority: medium
created: 2026-07-20
updated: 2026-07-20
tags: []
parent: SPEC-059
---
# Implementation — SPEC-059 requirement-layer quantifiability lint

## Goal

Implement SPEC-059: reuse the SPEC-052 lexical lint at requirement write-time via
a shared `lintStatement` primitive, wired into `RequirementService.addRequirement`,
config-toggled by `workflow.requirement_quantifiable.enabled` (default true).

## Approach — single vertical slice (one implementer, one worktree)

The change is small and cohesive (one core refactor + one service wiring + one
config resolver + tests). One task, six-dimension test coverage.

### Phase 1 — implement + verify

**T1** — `lintStatement` extraction + requirement-layer wiring + tests
- Extract `lintStatement(text: string): Omit<AcQualityFinding,"ac_id">[]` (or an
  ac_id-less finding shape) in `packages/core/src/ac-quality.ts`; re-express
  `lintAcQuantifiability` as a per-criterion map over it (skip script-mode ACs),
  output byte-identical (regression fixture).
- Add `resolveRequirementQuantifiableEnabled(config)` mirroring
  `resolveAcQuantifiableGateEnabled` (default true).
- Wire the primitive into `RequirementService.addRequirement`: lint the new
  statement (only when the knob is enabled) BEFORE persisting; on ≥1 finding
  return `VALIDATION_ERROR` with a message enumerating `R-id: <word> → add a
  measurable token or benchmark anchor`.
- Tests (six-dimension): HAPPY (quantified accepted) / NEGATIVE (vague rejected) /
  BOUNDARY (knob false accepts) / ERROR (message names word) / STATE (existing
  vague requirement not retroactively blocked) / REGRESSION (lintAcQuantifiability
  byte-identical + a CLI e2e spawning from source for exit 2/0).

## Definition of Done

- All 6 SPEC-059 ACs attested via `lore verify` (script-mode, exit-code-derived).
- `bun run typecheck` exits 0; `bun run test` both runners green.
- Code anchors declared on the spec post-landing (`lore anchor add`).
- Handoff + assessment recorded.

## File anchors (mutex)

- `packages/core/src/ac-quality.ts`
- `packages/lore/src/service/requirement-service.ts`
- `packages/core/tests/unit/ac-quality.test.ts`
- `packages/lore/tests/unit/service/requirement-service.test.ts`
- `packages/lore/tests/integration/requirement-quantifiable-cli.test.ts`
