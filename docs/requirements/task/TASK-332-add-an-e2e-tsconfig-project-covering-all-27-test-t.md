---
id: TASK-332
type: task
role: plan
title: "Add an e2e tsconfig project covering all 27 test-tree files and make the route-tree prerequisite explicit instead of positional"
status: archived
priority: medium
phase: "coverage"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-077
plan: PLAN-077
---
Two gaps, one task because both touch root `package.json` and cannot be claimed concurrently.

**C1** — measured census of `packages/dashboard/tests/e2e/`: 8 `.pw.ts` + 6 `.spec.ts` + 13 other `.ts` = **27 total**, and a grep over every `tsconfig*.json` confirms no project resolves that directory. The existing exclude's REASON is sound (helpers import from `packages/lore/src/**`, outside `rootDir: "."`, yielding 102 TS6059 + 7 TS2307 + 8 TS2868 of pure noise) — so add a project WITHOUT `rootDir`, do not relax the existing one.

⛔ AC-TC-1 counts the program's resolved FILES, not the project's existence. Resolving zero files under `tests/e2e/` is exactly the failure `tsconfig.tests.json` itself shipped with — its exit 0 was the exit code of checking nothing.

⛔ SAME UNIT (AC-TC-2): `tsconfig.tests.json`'s comment says the residual is "those two helper .ts files". At 27 that is a stale assertion understating itself 13x. Correct it to the measured figure and keep it greppable.

**C2** — `typecheck:dashboard` runs `router-cli generate && tsc`; `typecheck:dashboard-tests` runs only `tsc -p ...`. `src/routeTree.gen.ts` is git-ignored and generated only by the former, so the sub-script lies on a fresh clone. Make the dependency explicit: either generate idempotently, or fail loud naming the recovery command.

⛔ AC-TC-3's test must MOVE the generated file aside, run, restore it, and assert it is byte-identical afterwards — never leave the tree mutated.
