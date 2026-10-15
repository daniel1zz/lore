---
id: TASK-1170
type: task
role: plan
title: "lore context init --no-ai warns 'no usable AI provider' when AI was explicitly turned off"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"68a8a2b4-646c-4f8d-8704-46e8a2e92d68"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** The message says AI was disabled by --no-ai
**Actual:** context init --no-ai prints 'no usable AI provider'

Reported by: agent:main-orchestrator
