---
id: TASK-1386
type: task
role: plan
title: "main is red after plan-always-loaded-lore-fragments-state-the-rule-only closed: 3 tests pin fragment prose the compression rewrote"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"red-main","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0c7bd415-c793-461e-a7df-cea309059f31"}
---

On main (8395a3b6 plus fix merges that do not touch assets/context), after bun run build: packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts fails AC-CF-8 (expects a lore-corpus-workflow rules file to contain "Measure every oracle's exit code WITHOUT a pipe"; the compressed fragment now says "Measure an oracle's exit code WITHOUT a pipe"), and packages/lore/tests/unit/setup-governance-retirement.test.ts fails 2 STATE tests on the FEED bullet's handoff-neutrality wording. The plan that rewrote the fragments closed with these red, so its close-out never ran these consumers (they pin literal prose but name no changed path, a known test:changed under-selection). Found 2026-10-16 while verifying plan-close-the-eight-verified-critical-defects; confirmed red on main before that plan's F6 merge.

**Expected:** Closing a plan that rewrites assets/context fragments leaves every test that pins fragment prose green on main (either the tests assert the rule, not the literal wording, or the plan updates them)
**Actual:** 3 failing tests on main: AC-CF-8 in context-fragments-compiled.bun.test.ts, 2 handoff-neutrality STATE tests in setup-governance-retirement.test.ts
**Repro command:** `bun run build && (cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts); bunx vitest run packages/lore/tests/unit/setup-governance-retirement.test.ts`

Reported by: agent:session-c1ffea04
