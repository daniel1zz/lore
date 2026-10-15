---
id: TASK-1190
type: task
role: plan
title: "lore reject on an in-review doc moves it to draft without writing a version row, so the version log still shows in-review at the current version"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"audit-history","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"de453563-9d4d-4482-a01c-0bcbf3c86704"}
---

Found by the W5 probe author of plan-baseline-review-branch-migration-the-first-branch-eligible; not fixed there.

**Expected:** A status change made by reject is recorded as a version row (or the doc's status is not changed without one), so lore log and the stored doc agree
**Actual:** Throwaway corpus (review re-probe author, 2026-10-09): an in-review doc rejected -> status draft, but the latest version row (v2) records in-review while the doc at v2 is draft. Companion of #67 (wrong 'status remains: draft' message)

Reported by: agent:main-orchestrator
