---
id: TASK-975
type: task
role: plan
title: "main red: check-test-budgets exits 5 after c419c922 (context-provenance-compiled ledger orphans, session-bootstrap-seat-injection spawns without timeout)"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"main-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c685b0d5-354d-4ebb-9708-0f84faecba9e"}
---

After the merge of c419c922 (task-hook-phase-e-empty-injection-is-not-degradation-framing, merged c72e5d77), bun scripts/check-test-budgets.ts exits 5: two scripts/test-budget-ledger.json entries for packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts no longer match a real violation (titles changed), and packages/lore/tests/unit/hooks/session-bootstrap-seat-injection.test.ts:214 plus context-provenance-compiled.bun.test.ts:339 spawn >=3 times without a declared timeout. scripts/tests/check-test-budgets.test.ts fails on main as a result.

**Expected:** A test edit that renames a ledgered title or adds a spawning case updates scripts/test-budget-ledger.json or declares the timeout in the same commit
**Actual:** check-test-budgets exits 5 on main; its vitest wrapper fails
**Repro command:** `bun scripts/check-test-budgets.ts`

Reported by: agent:session-e25636da
