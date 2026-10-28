---
id: TASK-2100
type: task
role: plan
title: "Test runs never reach the checkout's own corpus"
status: draft
priority: medium
phase: "Honesty"
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PLAN-256
plan: PLAN-256
links:
  - {id: TASK-2091, type: blocks}
  - {id: TASK-2098, type: blocks}
---
## Objective
Stop test runs from reaching the checkout own corpus at the write site the honesty experiment located (O1-S3 path A, `knowledge-experiment-o1-honesty-of-the-evaluation-data`): feed-resume-same-session.test.ts builds test-session-<ms>-<random> ids; the `identity` getter in packages/lore/tests/live-invocation.ts calls registerRunInCurrentCorpus -> registerTestRun; findCorpusRoot hops from a linked worktree to the main checkout; registerRunInDb (packages/lore/tests/helpers/test-run-identity.ts) inserts the run. The existing env-based guards did not stop the 81 leaks (all registered after the guards were committed), so registerRunInDb must refuse the repo's own corpus without depending on the environment. Add the throwaway-clone oracle whose census covers the whole test tree. The 81 rows already leaked are not deleted or filtered here: the origin task's one-time repair marks them test (BR-1455, A-D17); this task blocks it.

Closing condition: record the attested RED run of AC-EM-6 on the pre-fix code first (`lore evidence --result expected-fail --capture`), then the fix and the green run. If the experiment did not locate the writer (branch O1-S3 B), this task is not claimed: plan 1 stops and S-A is re-reviewed; no filter hides test rows.

Spec: spec-evaluation-metric-envelope-and-honest-origins (BR-1386). Resolves #411.

Covers: AC-EM-6
