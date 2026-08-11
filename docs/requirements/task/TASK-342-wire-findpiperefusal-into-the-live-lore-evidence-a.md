---
id: TASK-342
type: task
role: plan
title: "Wire findPipeRefusal into the live lore evidence and MCP evidence_add call sequences, so the guard stops being dormant"
status: archived
priority: high
phase: "mechanisms"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
plan: PLAN-081
---
⛔ This task exists because the PRECEDING slice's anchors were mine and they were wrong, not because its implementer erred. `findPipeRefusal` was authored and exhaustively tested in `evidence-precheck.ts` (merged), but NEITHER call site is inside that task's anchors, so the guard is DORMANT: `lore evidence` still accepts a piped self-report today.

That is the exact failure class root CLAUDE.md records: capability implementation is not production wiring, and the two MUST be one acceptance unit — anchoring only the capability site yields all-green ACs with the defect untouched (four measured same-shape false greens).

## Requirement

Call `findPipeRefusal({ oracle, result, command, capture })` at BOTH live sites, positioned after the missing-oracle-file and mixed-runner guards (the ordering rationale those already document):
- `packages/lore/src/adapters/cli/commands/evidence.ts`
- `packages/lore/src/adapters/mcp/tools.ts` (the `lore_evidence_add` handler)

Neither site has a generic guard loop to extend, so each needs one explicit call — the implementer of the preceding slice verified this.

## AC-FALS-9 — the oracle must assert a LIVE process, never a source scan

⛔ A grep proving the call exists is a PROXY, not the property. The bound oracle must invoke a real `lore evidence` process and read its exit status: piped `--command` without `--capture` → exit 4; the SAME piped command with `--capture` → exit 0. The `--capture` half is load-bearing; without it a blanket refusal passes as green.

⛔ Measure the exit status in a statement SEPARATE from any pipe (`cmd > log 2>&1` then `echo $?`). Writing `cmd | tail` yields tail's 0 — which is the very defect this mechanism refuses, and the repo has now been bitten by it three times.

## Out of scope

⛔ Do NOT modify `evidence-precheck.ts` — the guard itself is merged and correct; this slice only calls it. ⛔ Do NOT change `--capture` behaviour.
