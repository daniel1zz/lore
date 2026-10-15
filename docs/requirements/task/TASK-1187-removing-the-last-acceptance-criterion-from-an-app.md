---
id: TASK-1187
type: task
role: plan
title: "Removing the last acceptance criterion from an approved spec leaves it approved with zero criteria, though approval refuses a spec with zero criteria"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"lifecycle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f1ee30cc-e6ea-433f-94cf-a8f8ae4a6abe"}
---

Found by the W5 probe author of plan-baseline-review-branch-migration-the-first-branch-eligible; not fixed there.

**Expected:** lore ac rm of the last criterion on an approved spec is refused, or demotes the spec (the same condition approval enforces), with a notice
**Actual:** Throwaway corpus (review re-probe author, 2026-10-09): ac rm of the only criterion on an approved spec -> accepted, spec stays approved with 0 criteria, a version is logged, no notice

Reported by: agent:main-orchestrator
