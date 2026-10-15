---
id: TASK-1348
type: task
role: plan
title: "Landing a spec's rule change set (plan close / lore rule apply) leaves each touched leaf's prose contradicting the new rules, and re-approval does not stop on the judge's reject"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"baseline-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f9499aba-ea89-4e9a-bcfb-c5e4ff814be7"}
---

Measured 2026-10-15: closing four plans applied their change sets (BR-104, BR-849, BR-907, BR-909/910 retired, BR-912, BR-1066, BR-1085..1094). Nine leaves were demoted to draft. lore review then REJECTED eight of them for prose contradicting the landed rules (e.g. baseline-plan-the-work prose says plan approval needs a spec 'exactly approved, not active' while BR-104 now says approved or active; baseline-check-installation-freshness prose says the project scaffold has no freshness check while BR-1085 is live). lore approve nonetheless approved all eight with exit 0 and no warning (#159), so the corpus briefly held approved leaves that contradict their own rules.

**Expected:** Landing a change set either requires the leaf prose to be revised in the same unit (e.g. the plan-close gate lists the touched leaves and refuses until each has a current-version approve judgment), or the leaf records which prose statements the change set invalidates
**Actual:** Rules land, prose stays stale, and a plain lore approve re-approves the contradictory leaf over a reject verdict

Reported by: agent:session-66711aa8
