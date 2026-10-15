---
id: TASK-947
type: task
role: plan
title: "[Skill:implement] falsifier expected exit code 1-255 at declaration and at verify --falsify (#43)"
status: archived
priority: high
phase: "falsifier-range"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-931, type: blocks}
  - {id: TASK-942, type: blocks}
  - {id: TASK-960, type: blocks}
  - {id: TASK-1258, type: resolves}
---
Estimate: M
Approach: (1) service/ac-write-chokepoint.ts `admitAcWrite`: for each criterion that is new or whose falsifier differs from the stored one, on every AcWritePath (ac-verb, create, import, restore, wholesale), refuse `expected_exit_code` that is not an integer in 1..255 with VALIDATION_ERROR field `falsifier.expected_exit_code`, before any write (spec D3). A write that leaves a stored falsifier unchanged is never refused because of it. Do NOT touch `acFalsifierSchema` (packages/core/src/acceptance.ts, D4). (2) ac-service.ts only as needed to pass the stored criterion to the chokepoint for comparison. (3) commands/ac.ts: `--falsifier-exit-code` help text says 1..255; parsing unchanged (:842-860). (4) VerifyRunnerService `_runFalsifier` (verify-runner-service.ts:1766+): before the green control, refuse a stored value outside 1..255 with VALIDATION_ERROR naming `lore ac set <spec> <AC> --correction "<reason>" --falsifier-exit-code <n>`; executor and recorder untouched (D5). Run scoped: the four RED files, every test importing ac-write-chokepoint.ts / ac-service.ts / verify-runner-service.ts (hand-pick), `bun run build` before the e2e, `bun run typecheck`.
Source: spec-evidence-labels-and-reds-are-honest D3, D4, D5; issue #43; facts acceptance.ts:167-171, ac.ts:842-860, verify-runner-service.ts:1766/:1965, ac-write-chokepoint.ts admitAcWrite.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-EH-3, AC-EH-4, AC-EH-5, AC-EH-11

AC:
- AC-EH-3, AC-EH-4 and AC-EH-5 commands print their PASS lines.
- `bun run typecheck` exits 0; `git diff --stat main -- packages/core/src/acceptance.ts` is empty.
- Commit before attesting; stop at `lore release`.
