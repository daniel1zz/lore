---
id: TASK-942
type: task
role: plan
title: "[Skill:implement] one shared pipe detector; the AC write chokepoint refuses unsafe-piped commands except under other (#19)"
status: archived
priority: high
phase: "pipe-refusal"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-937, type: blocks}
  - {id: TASK-960, type: blocks}
  - {id: TASK-885, type: resolves}
---
Estimate: M
Approach: (1) Move `commandHasUnsafePipe` (adapters/cli/evidence-precheck.ts:907, with its JSDoc including the Proxy / false-positive note at :995-1003) to a new pure module packages/core/src/command-pipe.ts, exported from packages/core/src/index.ts; browser-safe (no Node import — packages/core/src/CLAUDE.md). evidence-precheck.ts imports and re-exports it; no second definition remains. (2) service/ac-write-chokepoint.ts `admitAcWrite`: for each criterion that is new or whose command / oracle / mode changed, on every AcWritePath: script mode with any oracle except `other` and `commandHasUnsafePipe` true → VALIDATION_ERROR field `command`, naming the pipe segment and the POSIX form `f=$(mktemp); <check> > "$f" 2>&1; ec=$?; cat "$f"; [ "$ec" -eq 0 ] && grep -q <pattern> "$f"` (no here-string: verify runs `sh -c`); under `other` → admit and add an advisory naming the pipe to `AcWriteAdmission.advisories` (spec D7, user decision U1). (3) ac-service.ts passes advisories through; commands/ac.ts prints each as `advisory: <text>` on stderr, exit unchanged. Run scoped: RED files, existing pipe-refusal tests (`grep -rl findPipeRefusal packages/lore/tests`), every test importing ac-write-chokepoint.ts / ac-service.ts, `bun run build` before the e2e, `bun run typecheck`.
Source: spec-evidence-labels-and-reds-are-honest D3, D6, D7; issue #19; facts evidence-precheck.ts:907/:995-1003/:1063, verify-spawn.ts:43, ac-write-chokepoint.ts admitAcWrite.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-EH-6, AC-EH-7, AC-EH-11

AC:
- AC-EH-6 and AC-EH-7 commands print their PASS lines.
- Existing AC-FALS-9 pipe tests stay green; `bun run typecheck` exits 0.
- Commit before attesting; stop at `lore release`.
