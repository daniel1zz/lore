---
id: TASK-1182
type: task
role: plan
title: "Deleting a document writes a version row numbered 0"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"audit-history","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"113897dd-ad72-4cc8-96b9-be30b8a4e54d"}
---

Found by the W6 remediation drafter of plan-baseline-review-branch-migration-the-first-branch-eligible (code reading + throwaway corpus); not fixed there.

**Expected:** Delete logs a well-formed version row, and approve/reject of a soft-deleted document is refused (see #70)
**Actual:** Version 0 row on delete; later approve increments the version of a still-deleted doc

Reported by: agent:main-orchestrator
