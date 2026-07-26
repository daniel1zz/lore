---
id: TASK-144
type: task
role: plan
title: "[Skill:implement] T3 CLI --injection flag + config threading"
status: draft
priority: high
phase: "Phase 2: Surfaces (parallel)"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-032
plan: PLAN-032
links:
  - {id: TASK-140, type: blocks}
---
Estimate: M
Approach: add boolean `--injection` to the citty args of packages/lore/src/adapters/cli/commands/bootstrap.ts (declared flag → SPEC-051/073 strict seam accepts it; typo'd variants keep failing exit 2). Resolve workflow.bootstrap_injection.* once (mirror resolveClaimTtlMinutes's one-resolution-path shape — packages/lore/src/app.ts or command-level via loaded config, whichever the existing bootstrap command already threads config through). Call buildBootstrapInjection(report, budgets) and print result.json verbatim (already compact). Plain `--json` and human-format paths byte-unchanged. `--injection` implies JSON output; `--injection` + `--json` together are allowed (same output) or rejected consistently — pick one, document in the command JSDoc, pin in T6.
Integration: `dist/lore bootstrap --injection` is reachable from the compiled binary and is what the session-start hook (T4) spawns; T6's e2e exercises exactly this surface.
Source: SPEC-080 §Module Boundary (CLI bullet) + D3/D5; existing command file's --seat-branch flag as the flag-wiring pattern.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — flag is the hook's consumption seam
Covers: AC-080-3, AC-080-5, AC-080-6

AC:
- `bun run typecheck` → exit 0.
- Smoke (throwaway corpus via mkdtemp + lore init, NEVER the repo .lore/): `bun run dev bootstrap --injection` prints compact JSON whose first key is resume_hint and whose last keys are omitted (+budget_exceeded iff set); `bun run dev bootstrap --json` on the same corpus prints the unchanged full report (9-key set).
- strict-flags: `bun run dev bootstrap --injectoin` exits 2 with a Did-you-mean suggestion.
- Config threading: setting workflow.bootstrap_injection.max_active_plans=1 in the throwaway corpus's .lore/config.yaml changes the smoke output accordingly (knob reaches the fn — never decorative).
