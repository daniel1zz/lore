---
id: TASK-1633
type: task
role: plan
title: "13 test files that import helpers/cli-live-rule.ts fail with UndeclaredTestInputError since the per-item approval landing"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"tests","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6f6302b0-0a1a-4f64-b489-704aa0ae873a"}
---

fa1de05b (per-item baseline approval T2) changed packages/lore/tests/helpers/cli-live-rule.ts (lines 75, 152) to call approveFixtureNodes(), which spawns 'bun run packages/lore/tests/helpers/approve-nodes-cli.ts'. The read recorder (scripts/test-read-recorder.ts) requires every test that reaches a spawned input to declare it with '// @spawns <path>' in its leading comment block. T2 added the header to the 18 consumers it edited but not to 13 others. A full 'bun run test' at fa1de05b versus its first parent a771940c shows exactly these files as newly failing: e2e/ac-set-correction-compiled, e2e/plan-close-invariants-compiled, e2e/plan-exempt-attestation-compiled, e2e/record-lock-compiled, e2e/issue-check (+1), integration/autonomy-overrides-escalate, integration/change-set-reservation-live-specs, integration/cli-feed-task-start, integration/cli/tiered-review-gate, integration/decision-detail-producers, integration/p2-e2e-closed-loop, integration/rule-propose-amend, integration/spec-loop-e2e (all under packages/lore/tests/). check:floor does not run these files, so integrate landed the branch.

**Expected:** Every test file that transitively spawns approve-nodes-cli.ts declares it, and the 13 files pass as they did at a771940c.
**Actual:** UndeclaredTestInputError: test "<hook>" in packages/lore/tests/e2e/record-lock-compiled.bun.test.ts used repository inputs it does not declare (and likewise for the other 12 files; 34 failing tests in total).
**Repro command:** `bun run test:file packages/lore/tests/e2e/record-lock-compiled.bun.test.ts`

Reported by: agent:session-a979eecd
