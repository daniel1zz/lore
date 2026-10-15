---
id: TASK-1207
type: task
role: plan
title: "lore set --status approved on an adr or spec skips the review verdict that lore approve requires, and logs it as a plain update"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gate-bypass","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"795c0a90-c89c-4a8a-b520-ff4e3f93b1ed"}
---

Found by the review-branch probe author (plan-baseline-review-branch-migration-the-first-branch-eligible, W0) on a throwaway corpus; not fixed in that plan. An unreviewed ADR refused by lore approve becomes approved via lore set <adr> --status approved, exit 0; lore log shows a plain update row. Sibling of the plan-promote bypass already filed for plans

**Expected:** Setting status to approved through lore set is refused (or applies the same review-verdict precondition as lore approve), and an approval is recorded as an approval in the version history
**Actual:** An unreviewed ADR refused by lore approve becomes approved via lore set <adr> --status approved, exit 0; lore log shows a plain update row. Sibling of the plan-promote bypass already filed for plans

Reported by: agent:main-orchestrator
