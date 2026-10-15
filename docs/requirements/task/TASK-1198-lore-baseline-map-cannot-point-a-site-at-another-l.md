---
id: TASK-1198
type: task
role: plan
title: "lore baseline map cannot point a site at another leaf's rule, so shared-command sites are filed as non-business 'owned-by' text"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"census-honesty","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ae991eb9-5064-4ca9-b53b-c437fcdcb976"}
---

Workaround applied in the review-branch migration: build.py set_command_target maps shared sites to non-business text naming the owning leaf and rule. The reason text is honest but unstructured; a census over non-business sites over-counts infrastructure. Filed per the gate-gap rule (a workaround is the signal).

**Expected:** A census site reached by a command shared by two leaves can be mapped to the rule (on the other leaf) that governs it, and coverage counts it as business-covered
**Actual:** rule-service.ts:524 accepts only rule ids of THIS leaf or non-business:<reason>. The review-branch migration (plan-baseline-review-branch-migration-the-first-branch-eligible) had to map shared approve/set sites as 'non-business:owned-by baseline-approve-a-spec BR-72 ...', so a business refusal is labelled non-business and coverage cannot tell the two apart

Reported by: agent:main-orchestrator
