---
id: TASK-833
type: task
role: plan
title: "Move the pure import-graph core to @lore/core and prove both consumers call it"
status: deprecated
priority: medium
phase: "P1 one fan-in definition"
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-147
plan: PLAN-147
---
## Objective

Give `buildImportGraph` ONE home and TWO proven live consumers. Claims AC-GRADE-2.

## The change

1. Move the PURE half of `scripts/changed-tests.ts` — `extractImportSpecifiers`,
   `resolveImportSpecifier`, `buildImportGraph`, and the `FileMap`/`AliasMap`/`ImportGraph`
   types — into `packages/core/src/import-graph.ts`, re-exported from `@lore/core`.
   ⛔ The IO half (`loadFileMap`, `walkDir`, anything touching `node:fs`) STAYS behind the
   Node boundary — `@lore/core`'s default barrel must never top-level-import a Node
   builtin, or the dashboard SPA blanks before React mounts.
2. `scripts/changed-tests.ts` imports and CALLS the moved definition. Zero behaviour
   change to its selection output.
3. Add the grade module's consumer call site. It may be a thin `adjustedFanIn(anchors)`
   helper — the grade function itself is P2's task, not yours.
4. Three suites: `fanin-ssot.test.ts` (exactly ONE tree-wide definition + an import-graph
   edge per consumer), `changed-tests-consumer.test.ts` and `grade-consumer.test.ts`
   (each independently reaches the declared falsifier exit code under the declared
   mutation).

## ⛔ Per-consumer observation is the point

AC-GRADE-2 was rewritten specifically to forbid one aggregate observation over both
consumers: if only one genuinely calls the definition, a single mutation still yields the
recorded code and the AC goes green with half its claim false. That is why there are TWO
consumer suites, not one covering both. Do not merge them.

## Falsifier — you must declare it

The AC currently has no `--falsifier-*` fields because the definition site did not exist
at authoring time. After the move lands, declare all four via `lore ac add` is NOT
available (the spec is approved) — instead report the four values you measured in your
return message and the orchestrator will record them. `falsifier_path` MUST equal the new
`packages/core/src/import-graph.ts`, and the exit code MUST be vitest's assertion-failure
code 1, never 2 or above (a crash proves the rule never ran).

## Baseline check before you measure anything

⛔ Your worktree is built from `origin/main`, which is 8 commits BEHIND local main. Run
`git rebase main` FIRST, then confirm `git log --oneline -1` matches what the orchestrator
told you, before trusting any measurement.

## RED first, recorded at the moment of red

Write the three suites, run them, record `lore evidence --result expected-fail` with the
real failing output WHILE IT IS RED. Then implement and record the pass.
