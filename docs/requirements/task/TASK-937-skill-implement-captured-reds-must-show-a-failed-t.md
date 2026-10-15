---
id: TASK-937
type: task
role: plan
title: "[Skill:implement] captured reds must show a failed test and are never exit 126/127, on CLI and MCP (#53)"
status: archived
priority: high
phase: "red-proof"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-960, type: blocks}
  - {id: TASK-1242, type: resolves}
---
Estimate: M
Approach: (1) packages/core/src/attestation-completeness.ts: add `parseFailedCaseCount(stdout): number | null` reusing `VITEST_TESTS_LINE_PATTERN` (failed segment) and adding ONE bun pattern for the ` N fail` summary line (bun prints ` 1 pass` / ` 1 fail` / `Ran 2 tests across 1 file.`, measured 2026-10-12); null when no recognised summary (D8). (2) evidence-precheck.ts: `findCapturedRedProofGap({ oracle, result, capture, exitCode, outputTail })` → LoreError | null: capture false → null; result not fail/expected-fail → null; exit 126/127 → VALIDATION_ERROR naming the code for ANY oracle (D9); oracle test/e2e with no summary or failed count 0 in the STORED tail → VALIDATION_ERROR naming RUNNER_SUMMARY_FORMATS_DESCRIPTION and `2>&1` (D8). (3) Call it in commands/evidence.ts and mcp/tools.ts right after `findCapturedFailDiscoveryRefusal` (tools.ts:2267-2285), same LoreError on both (D10). `captureOracleCommand` (evidence-capture.ts) stays unchanged. Re-baseline the anchored pinned tests. Run scoped: AC-EH-8/AC-EH-9 files, existing discovery-refusal and capture tests (`grep -rl findCapturedFailDiscoveryRefusal packages/lore/tests`), `bun run typecheck`.
Source: spec-evidence-labels-and-reds-are-honest D8, D9, D10; issue #53; facts evidence-capture.ts:430-443/:141, evidence-precheck.ts:1192-1212, tools.ts:2267-2285, attestation-completeness.ts:525-588.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-EH-8, AC-EH-9, AC-EH-11

AC:
- AC-EH-8 and AC-EH-9 commands print their PASS lines.
- `bun run typecheck` exits 0. Commit before attesting; stop at `lore release`.
