---
id: TASK-1514
type: task
role: plan
title: "[Skill:implement] TG-32 evidence precheck follows the one-runner rule; SPEC-166 stale test path"
status: archived
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: Since T23 (90c2b081) every test runs under one runner (vitest on the Bun runtime) and `.bun.test.ts` names were kept. packages/lore/src/adapters/cli/evidence-precheck.ts still enforces the retired two-runner split (BUN_ONLY_FILE_SUFFIX, the mixed-runner refusal; also referenced from adapters/mcp/tools.ts, commands/evidence.ts and packages/core/src/attestation-completeness.ts): measured 2026-10-17 by T11D2, `lore evidence --capture` refused `bunx --bun vitest run <x>.bun.test.ts`, forcing evidence through the retired `bun test`. Find the governing spec and AC (search "mixed runner", task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a, the evidence-mixed-runner-guard-compiled test), decide what still protects a consumer (a consumer project may still run two runners: the guard's real harm case is a runner silently dropping a file it cannot run) and correct the criterion with `lore ac set --correction` stating the one-runner change, then change the precheck accordingly with red-first tests. Also: docs/requirements SPEC-166 (spec-session-start-injection-carries-only-the-session-s…) still lists the deleted packages/lore/tests/e2e/governance-bootstrap-framing-compiled.bun.test.ts (its tests moved to context-provenance-compiled.bun.test.ts in the T11D2 merge): correct that reference in the corpus spec (not the mirror file).
Source: spec-test-governance-guards-that-refuse-bad-tests-declared; ADR adr-tg-1-test-runner-decision-measured-comparison-of-bun-only
AC: lore evidence --capture accepts `bunx --bun vitest run <file>.bun.test.ts` in this repo; the harm the guard existed for is still refused (red-first); SPEC-166 names no deleted file.
