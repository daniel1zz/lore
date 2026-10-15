---
id: TASK-1059
type: task
role: plan
title: "The test-budget scanner cannot parse a regex inside a template literal"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tooling","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"62690e5b-810e-4405-b023-3500f22d11d6"}
---

Found 2026-10-11: report-issue-body-contract.bun.test.ts's quote helper had to be rewritten to satisfy check-test-budgets.

**Expected:** check-test-budgets parses any valid TypeScript test file
**Actual:** a helper containing a regex inside a template literal is mis-scanned and fails the budget check

Reported by: agent:main-orchestrator
