---
id: TASK-507
type: task
role: plan
title: "T5 stop-handoff-coverage hook as blind pipe"
status: archived
priority: medium
phase: "enforce"
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PLAN-100
plan: PLAN-100
links:
  - {id: TASK-506, type: blocks}
---
## Objective

The Stop hook as a blind pipe. It relays; it never decides (spec D9).

## Deliverables

- `assets/hooks/stop-handoff-coverage.mjs`: read the Stop payload from stdin, forward the two channels to `lore handoff coverage-check`, relay stdout / stderr and the exit code verbatim.
- Honour the `stop_hook_active` passthrough for loop prevention, exactly as `stop-doc-sync.mjs` does.

## ACs

AC-RC-10 — zero hits for every exported item-id prefix and every exported disposition token in the hook source (proving no grammar), AND a stub binary earlier on PATH that exits 3 with a known stderr string yields exit 3 and that stderr verbatim from the hook (proving relay, not decision).

## Constraints

Spec D9: the hook holds no id format, no disposition tokens, no matching logic. An installed `.mjs` cannot be identity-asserted against exported constants and drifts from the binary independently — the defect class SPEC-083 retired for governance prose.

Depends on T3 (the verb must exist). Do NOT regenerate the assets manifest; T4 owns it. Do NOT edit `assets/hooks/lib/turn-state.mjs` — out of scope per the spec, and its `CLAUDE_SESSION_ID` defect is recorded separately.
