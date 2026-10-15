---
id: TASK-1130
type: task
role: plan
title: "Discarding a plan or a draft leaves no reason and runs no check: lore set --status deprecated skips every plan-close condition, and draft -> archived on knowledge needs no reason"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"lifecycle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"37e2d16b-8a8f-4bd4-98aa-f77b9defb543"}
---

Measured 2026-10-10 during the historical-debt cleanup (knowledge-historical-execution-debt-cleanup-2026-10-10-68): 15 plans moved approved -> deprecated and 14 knowledge drafts moved draft -> archived with plain lore set; no reason field exists, so why each was discarded lives only in a separate retro. 4 plans whose tasks were all archived were deprecated because plan-close refused archival on ASSESSMENT_STALE; nothing distinguished 'abandoned' from 'completed but not re-assessed', and the label is terminal.

**Expected:** Discarding (deprecate, or archive from draft) requires a non-empty reason stored on the doc and shown by lore get; deprecating a plan whose tasks are all archived warns that it reads as abandoned and names the re-assess-then-archive path
**Actual:** Both transitions succeed with no reason and no warning

Reported by: agent:main-orchestrator
