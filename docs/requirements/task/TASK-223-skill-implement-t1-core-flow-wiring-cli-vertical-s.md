---
id: TASK-223
type: task
role: plan
title: "[Skill:implement] T1 core+flow+wiring+CLI vertical slice"
status: archived
priority: high
phase: "core-cli"
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-050
plan: PLAN-050
links:
  - {id: TASK-222, type: blocks}
---
Estimate: L
Approach: Mirror flows/phase-feed-flow.ts precedent with the review-mandated corrections: thick-bundle/thin-flow (ALL derivation — computeAcCoverage, extractClaim/isClaimStale, fail-evidence extraction — happens in adapters/cli/task-feed-wiring.ts::buildTaskFeedFlowDeps over CorpusService.getPlanBundle + TaskWorkflowService.ready; the flow only renders pre-derived strings/structs). New flows/feed-shared-types.ts owns KnowledgePointer/HandoffPointer (phase-feed-flow re-exports for import-compat). New adapters/cli/task-feed-render.ts exports renderTaskStartPack (assess-render.ts split precedent). commands/feed.ts refactored to a checkpoint→handler table (spec-create generic path stays the fallback). workflow.task_feed budgets join WorkflowConfigSchema in packages/core/src/config.ts (additive subtree, pure Zod — NO Node imports, browser-safe barrel).
Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start §Design D1-D7, D9; read flows/phase-feed-flow.ts + adapters/cli/phase-wiring.ts + tests/unit/flows/phase-feed-flow.test.ts (CONTRACT NOTE pattern) first.
Dimensions: D-FUNC, D-CODE
Scope-Alt: the feed.ts table-driven refactor may degrade to adding the 4th if-branch IF the regression pins prove the refactor riskier than expected — record the deviation in evidence output_tail; everything else is non-negotiable.
Covers: AC-070-1, AC-070-2, AC-070-3, AC-070-4, AC-070-5, AC-070-6, AC-070-7

AC:
- Given identical fake deps, when buildTaskStartPack runs twice, then packs deep-equal AND the flow module imports no derivation fns (AC-070-1)
- Given a failing aux port, when the pack builds, then only that section degrades to a one-line note (AC-070-2)
- Given the acScope/criteria matrix (null/empty/dangling), when acceptance renders, then notes/marks/loud-rows per spec D4 (AC-070-3)
- Given fail evidence / none / unapproved spec, when constraints renders, then last-3 failures with clipped tails, explicit none-line, advisory (AC-070-4)
- Given foreign-fresh/stale/no claim + ready slice, when claim/plan_state render, then holder/stale/none lines + sessions/conflicts (AC-070-5)
- Given workflow.task_feed config overrides, when sections clip, then truncated[] keys exact (AC-070-6)
- Given the CLI, when task-start runs (happy/--json/missing-positional/unresolvable) and when spec-create/session-resume/phase-start re-run, then 8 headers / pack JSON / exit 2 / exit 3 / byte-unchanged outputs (AC-070-7)

Integration: `lore feed task-start <real-task-slug>` against a throwaway corpus prints all eight sections with real corpus data end-to-end — the feature is reachable from the shipped binary, not only from unit fakes.

Oracle scope (MUST stay scoped — never full suite in the worktree):
- bunx vitest run packages/lore/tests/unit/flows/task-feed-flow.test.ts (assert matched test-file count = 1)
- cd packages/lore && bun test tests/integration/cli-feed-task-start.bun.test.ts (needs `bun run build` first — dist/lore freshness)
- bunx vitest run --changed <merge-base>
- bun run typecheck
