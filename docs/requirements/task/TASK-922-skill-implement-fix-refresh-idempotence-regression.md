---
id: TASK-922
type: task
role: plan
title: "[Skill:implement] fix refresh idempotence regression (AC-CTX-3) and dedupe context helpers"
status: archived
priority: critical
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-910, type: blocks}
---
Estimate: M
Approach: Regression from task-skill-implement-context-refresh-fragments-z1-section-scope (merged 52d9b829). On main after `bun run build`, `cd packages/lore && bun test tests/e2e/context-verbs-compiled.bun.test.ts` fails 2 AC-CTX-3 tests: (a) "an immediately-following `context refresh` (no edits) reproduces byte-identical CLAUDE.md content" — the second refresh output is longer (reported +48 lines), i.e. refresh is NOT idempotent once the `fragments` section exists; (b) "hand-editing one line inside a managed section makes the next refresh report diverged_skip … and leave the file bytes untouched". Find the root cause (likely the fragments section is appended instead of spliced, or its fingerprint/hash is computed over different bytes than written, e.g. trailing newline handling in discover bodies / buildFragmentsSection) and fix it at the mechanism — do NOT weaken AC-CTX-3. Also remove the SSOT duplication introduced by task-skill-implement-setup-language-projection-via: `toContextLayer` and `makeRealContextFsPort` in commands/setup.ts are copies of private helpers in commands/context.ts — export once and import in both.
Source: spec D4, D8; existing spec-context-verb-family-two-zone-claude-md-anatomy-lore (AC-CTX-3 idempotence/diverged_skip contract)
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: (regression fix; keeps AC-CF-6 and AC-CTX-3 green)

AC:
- `bun run build && cd packages/lore && bun test tests/e2e/context-verbs-compiled.bun.test.ts` → 0 fail (red first recorded as expected-fail).
- `bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-6'` and `-t 'AC-CF-15'` still pass; `bunx vitest run packages/lore/tests/unit/context-fragments packages/lore/tests/unit/flows/context-flow.test.ts packages/lore/tests/unit/flows/context-flow-adoption.test.ts` pass.
- A new unit test asserts refresh twice with fragments produces byte-identical output (red before the fix).
- `grep -n "function toContextLayer\|function makeRealContextFsPort" packages/lore/src/adapters/cli/commands/*.ts` → each defined exactly once.
