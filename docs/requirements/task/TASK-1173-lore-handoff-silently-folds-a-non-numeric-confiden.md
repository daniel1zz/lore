---
id: TASK-1173
type: task
role: plan
title: "lore handoff silently folds a non-numeric confidence suffix (@high) into the decision text"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"no-silent-fallback","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f71b7cf4-e2c9-4f19-8dd7-2713405f93c1"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** A --decision whose @suffix is not a number is refused or warned
**Actual:** '--decision "X@high"' is stored as decision text 'X@high' with no confidence and no warning

Reported by: agent:main-orchestrator
