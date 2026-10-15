---
id: TASK-1197
type: task
role: plan
title: "AC-TIER-10's -t ai_provenance filter never runs the test for its positive half (real model id recorded)"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"false-oracle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"300ff5fb-c5e4-4bf6-9514-dd1c9fe80325"}
---

Found while placing review-branch criteria (plan-baseline-review-branch-migration-the-first-branch-eligible, W2). Fix belongs in the AC's verify.command (re-baseline), not in the test.

**Expected:** The AC-TIER-10 oracle runs both halves of its statement: a real model id is recorded when the provider exposes one, and provenance is omitted when it does not
**Actual:** bunx vitest list packages/lore/tests/unit/service/tiered-review.test.ts -t ai_provenance selects 2 tests: 'generate() omits ai_provenance when the active provider exposes no model id' and an AC-TIER-6 collision test. The positive-half test at tiered-review.test.ts:402 ('generate() sources a real per-provider model id ...') has no 'ai_provenance' in its title and is never run by the AC's command, so an attested pass certifies only the omit half

Reported by: agent:main-orchestrator
