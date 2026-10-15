---
id: TASK-1203
type: task
role: plan
title: "pending.ts and review-service.ts comments say a draft cannot be archived directly, but knowledge and task drafts can"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"doc-code-contradiction","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ca893b0c-47f2-4184-a151-fefd387e4b7e"}
---

Found by the review-branch probe author (plan-baseline-review-branch-migration-the-first-branch-eligible, W0) on a throwaway corpus; not fixed in that plan. A knowledge doc goes draft -> archived successfully; the comments state drafts cannot be archived

**Expected:** Comments at packages/lore/src/adapters/cli/commands/pending.ts:14 and review-service.ts:537-538 match the per-type lifecycle actually enforced
**Actual:** A knowledge doc goes draft -> archived successfully; the comments state drafts cannot be archived

Reported by: agent:main-orchestrator
