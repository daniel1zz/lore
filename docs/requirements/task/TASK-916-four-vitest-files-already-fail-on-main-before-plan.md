---
id: TASK-916
type: task
role: plan
title: "Four vitest files already fail on main before plan-context-fragments landed (anchor-coverage-ratchet, anchor-coverage-stale-exemption, mirror-status-parity, spec-mirror-export)"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"red-main","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"65580795-3578-4fd4-b906-5b1a455d042e"}
---

Triaged 2026-10-07 while closing plan-context-fragments-config-driven-layered-rule-injection: a full bun run test:vitest on main has 16 failures in 9 files; 5 of those files ALSO fail at the pre-plan base 165b237d^1 (= 67db6557), so they are not caused by that plan: packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts (6 failing), packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts (2), packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts (1, already tracked by the 'documentation edit put main's CLAUDE.md eviction floor red' issue), scripts/tests/mirror-status-parity.test.ts (1), scripts/tests/spec-mirror-export.test.ts (2). A red main makes every concurrent session's full-suite verdict unobtainable.

**Expected:** bun run test:vitest exits 0 on main
**Actual:** the four listed files fail at 67db6557 and still fail on current main
**Repro command:** `bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts scripts/tests/mirror-status-parity.test.ts scripts/tests/spec-mirror-export.test.ts`

Reported by: agent:main-orchestrator
