---
id: TASK-1172
type: task
role: plan
title: "lore context refresh prints 'Wrote CLAUDE.md' when it skipped hand-edited blocks and changed no byte"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"output-contract","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9ad6db99-8d83-491d-b76d-49979f734aa1"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** The output says nothing was written (and names the skipped blocks) when the file is unchanged
**Actual:** context refresh leaves the file byte-identical but prints 'Wrote CLAUDE.md'

Reported by: agent:main-orchestrator
