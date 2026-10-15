---
id: TASK-1065
type: task
role: plan
title: "Rule verification state ignores architecture standard rules: AS-n rules are citable but lore baseline tree --states / --rule only reads business leaves"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"doc-code-contradiction","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ae0c4dce-cc77-4522-b863-058f119af8b7"}
---

Found while reviewing baseline leaf 'Compute a rule's state' (BR-673). BR-980 lets an acceptance criterion cite an AS-n standard rule, but the state computation never sees standard nodes, so a cited AS rule can never become verified or contradicted.

**Expected:** A citable AS-n rule on an architecture standard gets a computed verification state like a BR-n rule; lore baseline tree --rule AS-n returns its state
**Actual:** rule-state-service.ts buildSnapshot collects rules only from docs with extra.node === 'leaf' (line 216); tree --rule AS-n is refused 'not held by any live baseline leaf' (line 423); --states JSON attaches rule_states only when node === 'leaf' (baseline.ts:155)

Reported by: agent:node-fixer-ab
