---
id: TASK-1174
type: task
role: plan
title: "lore create of a handoff or uat knowledge doc fails with a generic schema error instead of naming lore handoff / lore uat record"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"682c8365-1a3b-42e0-9205-509ac175a331"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** The refusal names the sole writer (lore handoff, lore uat record), as the code comments and rule files say it does
**Actual:** lore create knowledge --sub-type handoff|uat exits with a schema validation error that names no writer

Reported by: agent:main-orchestrator
