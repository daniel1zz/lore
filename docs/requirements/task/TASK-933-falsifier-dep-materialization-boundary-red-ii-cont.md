---
id: TASK-933
type: task
role: plan
title: "falsifier-dep-materialization BOUNDARY (RED ii) control intermittently fails: bun exits nonzero but the output lacks 'cannot find module'"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"test-flake","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e93688d8-b83b-4cb5-a7f7-c295ba412569"}
---

packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts:963 ('both runners: BOUNDARY (RED ii, permanently pinned)') runs 'bun test' inside a scratch worktree with materialization skipped and asserts the output contains 'cannot find module'. Measured 2026-10-12 on main (after the #48 merge): the same three-file vitest command (attested-red, verify-falsify-green-control, falsifier-dep-materialization) passed 41/41 in lore verify for one task, failed 1/41 on exactly this assertion in the next lore verify run a minute later (status was nonzero, so the first expect held; only the message differed), then passed 41/41 twice when re-run alone. The failing run overlapped another agent's 'bun run build' and test runs on the same machine. The stored 4000-char tail shows only the AssertionError, not bun's actual output, so the alternative error text is unknown. This is AC-EH-1's oracle, so a lore verify of that criterion can record a false fail.

**Expected:** The control deterministically observes the module-resolution failure (or asserts on a stable signal), independent of concurrent builds/tests on the machine.
**Actual:** Intermittent: 1 of 4 runs observed a nonzero bun exit whose output did not contain 'cannot find module'.
**Repro command:** `bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts`

Reported by: agent:session-f0196b68
