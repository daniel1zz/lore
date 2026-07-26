---
id: TASK-141
type: task
role: plan
title: "[Skill:verify] T7 attested sweep + spec anchors + live smoke"
status: draft
priority: high
phase: "Phase 3: Verification"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-032
plan: PLAN-032
---
Estimate: S
Approach: main-checkout verification sweep AFTER all P2/P3 branches merged to main (worktree oracles were scoped; the full suite runs ONCE here — N-way concurrent full suites starve spawn-type tests into false 30s timeouts). Prefix every lore call with LORE_ACTOR=agent:main-orchestrator.
Source: SPEC-080 §Rollout + plan Exit Criteria; CLAUDE.md worktree/oracle discipline
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — final gate
Covers: AC-080-4, AC-080-5 (attested), plus attested sweep of AC-080-1/2/3/6

AC:
- `bun run build` then `node scripts/embed-assets-manifest.mjs --check` → exit 0 (AC-080-4, measured un-piped: `cmd > out 2>&1; echo $?`).
- `bun run typecheck` → exit 0 (AC-080-5).
- `bun run test` (both runners, full suites, on main) → exit 0.
- `lore verify <this-plan>` → attested evidence recorded for ALL 6 script ACs, zero inconclusive (build-freshness + under-match prechecks green).
- `lore anchor add spec-080-bootstrap-injection-projection-tier-1-tier-2-payload` for: packages/core/src/session.ts#buildBootstrapInjection, packages/core/src/config.ts, packages/lore/src/adapters/cli/commands/bootstrap.ts, assets/hooks/session-start-resume.mjs — then `lore status --check-drift` → exit 0 (anchors declared AFTER code landed, never before).
- Live smoke: this repo's next SessionStart injection (or a manual hook run with CLAUDE_AGENTS_DIR_OVERRIDE) emits the tier-1 payload with resume_hint present and no truncation suffix.
