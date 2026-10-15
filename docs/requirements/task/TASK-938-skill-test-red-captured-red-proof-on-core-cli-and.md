---
id: TASK-938
type: task
role: plan
title: "[Skill:test] RED - captured red proof on core, CLI and MCP (#53)"
status: archived
priority: high
phase: "red-proof"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-937, type: blocks}
---
Estimate: M
Source: spec-evidence-labels-and-reds-are-honest AC-EH-8, AC-EH-9
TDD-Role: red | Paired-Impl: task-skill-implement-captured-reds-must-show-a-failed-test-126
Scenarios:
- NEW packages/lore/tests/unit/adapters/captured-red-proof.test.ts (AC-EH-8 a-g, j — (j) a summary pushed out of the 4000-char tail).
- RE-BASELINE packages/lore/tests/unit/adapters/evidence-capture-window.test.ts:252-257 (AC-EH-8 h): captureOracleCommand still returns 127; feed that outcome through findCapturedRedProofGap and expect the refusal. Record the original assertion and why (issue #53, BR-1077, BR-152).
- RE-BASELINE packages/lore/tests/unit/adapters/evidence-capture-attestation.test.ts:342-371 (AC-EH-8 i): the captured fail command prints a vitest failure line before exit 3.
- EXTEND packages/lore/tests/unit/adapters/mcp-evidence-capture.test.ts (AC-EH-9 a-c) and NEW packages/lore/tests/integration/cli/evidence-captured-red-proof-cli.test.ts (AC-EH-9 d, subprocess 'bun run src/index.ts').
Dimensions: HAPPY (vitest and bun summaries with a failure), NEGATIVE (no summary, 0 failed), BOUNDARY (126 vs 127, oracle other, tail window), ERROR (refusal on both surfaces), REGRESSION (capture false unaffected).
AC:
- Run every listed file against current main; each new case must fail on an ASSERTION (wrong label / missing refusal / row written), not a harness error. A red that is a call to a not-yet-existing export the paired task adds (TypeError / undefined is not a function) is acceptable only for that export; say so in the evidence.
- At the moment of red, the agent that ran it records `lore evidence <this task> --oracle <test|e2e> --command "<exact command> 2>&1" --result expected-fail --capture`, one row per file (`2>&1` is required: --capture stores all stdout then all stderr, so without it the runner summary can fall out of the stored tail). Never transcribe a red later.
- Commit the tests on this task's branch; the paired implement task branches from that commit plus every merged predecessor; never merge red to main alone.
