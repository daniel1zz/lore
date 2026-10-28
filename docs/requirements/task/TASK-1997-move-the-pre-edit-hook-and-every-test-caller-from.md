---
id: TASK-1997
type: task
role: plan
title: "Move the pre-edit hook and every test caller from --harness-run to the per-call run"
status: approved
priority: critical
phase: "P3 Callers"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-1996, type: blocks}
  - {id: TASK-1994, type: blocks}
---
Covers: AC-RV-4 (the residual grep over tests, scripts and assets is this task's oracle)
Approach: pre-edit-anchor-gate.mjs spawns lore anchor scope|declare with LORE_HARNESS_RUN in the child env instead of --harness-run (a hook is a harness child, so it verifies). Test helpers (tests/helpers/test-run-identity.ts, known-party-corpus.ts, test-invocation.ts, run-lore-in-process.ts) register the run with harness_pid = process.pid and the probed start time and pass the env value. Per BR-1386 (test runs never reach the checkout's own corpus) every helper registers runs ONLY into a throwaway corpus (mkdtemp + lore init) and never into the repo's .lore/; cite BR-1386 in the helper's header comment.
Files: the 29 anchors are the files listed by grep -rl -e --harness-run -e HARNESS_RUN_FLAG packages/*/tests scripts on 2026-10-26, plus the hook, MINUS two owned by the carrier task: packages/core/tests/run-identity-rewrite.test.ts (the carrier deletes it with the text rewriter) and packages/lore/tests/unit/hooks/pre-tool-harness-run-hook.test.ts (the carrier changes that hook's behaviour and rewrites its test). Each remaining anchor is edited here.
Ordering: blocked by the tool-server task (P2+P3 chain on the plan's integration branch) and it BLOCKS plan-evaluation-1's task-test-runs-never-reach-the-checkout-s-own-corpus through plan 418's close (that task also anchors test-run-identity.ts).
Oracle before integrating the chain: bun run test:changed against main, plus the hook tests by hand.
