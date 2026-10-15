---
id: TASK-1094
type: task
role: plan
title: "lore review on an architecture standard node never shows the judge each AS rule's four parts (current reality, target rule, current exceptions, migration), so every standard is rejected as missing them"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"review-judge","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"0435fede-55d3-400c-888c-27bb22b1c7a9"}
---

Measured 2026-10-10 on the six standard nodes of the lore architecture tree: each AS-n rule stores current_reality, target_rule, current_exceptions and migration in extra.rules (verified via lore get --json: 18/18 rules carry all four), yet lore review rejected or escalated all six nodes with findings like 'AS-11 and AS-12 each give only one statement' and the blocking question 'Where are the Current Reality, Current Exceptions (AD-n) and Migration parts?'. The judge input renders the rule statement (and metadata) only. Same family as #107 (rules not shown) and #114 (examples and commands not shown), but for the four-part standard fields added by the architecture tree.

**Expected:** The review bundle for a standard node renders every rule's four parts (and an explicit 'none' for an empty current_exceptions list), so the judge can check the four-part contract.
**Actual:** The judge sees only statements; every standard node is rejected or escalated regardless of content, and an author must duplicate extra.rules into the body to get an approval.
**Repro command:** `lore review baseline-standard-storage`

Reported by: agent:arch-author
