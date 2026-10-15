---
id: TASK-1133
type: task
role: plan
title: "lore review on a baseline node never shows the judge its rules (extra.rules), so every leaf escalates as 'no Rules section' and no baseline node can be approved"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"review-input","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"41020b6a-fdd9-4c9f-8727-4eba8b501ab0"}
---

Measured 2026-10-10: lore review baseline-cite-a-baseline-rule -> escalate 0.60, judge: 'The leaf has no Rules section... A reader can't see what any of the rules says'; the leaf holds 19 rules in extra.rules. lore approve then exit 4 on the escalation's blocking questions. All 121 baseline nodes are draft. Same class as the open issue where plan review feeds the parent spec body but not its structured ACs: the judge input is built from content only, never from the structured extra that IS the document for baseline (rules, glossary, depends_on) and spec (acceptance_criteria).

**Expected:** The judge input for a baseline node includes its rules (id, statement, confidence, lifecycle, examples), glossary and depends_on; for a plan/spec review, the governing spec's structured acceptance criteria; so a judgment reflects the document as stored
**Actual:** Judge sees only content; every baseline leaf is judged as missing its rules and escalated; approve refused

Reported by: agent:main-orchestrator
