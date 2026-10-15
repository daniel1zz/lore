---
id: TASK-1123
type: task
role: plan
title: "lore review on a baseline node does not show the judge each rule's examples or the node's declared commands, though the #107 spec says it does"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"review-input","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"82607288-0319-4a7e-898b-6e950080f9bb"}
---

The #107 fix (commit 8471ad34) renders a baseline node's structured parts for the judge, but renderBaselineStructuredSection (packages/lore/src/ai/review-template.ts:368-372) prints each rule as id, confidence, lifecycle, enforced_by and statement only. Every stored rule must carry 1-3 examples (packages/core/src/baseline.ts:38), and the governing spec spec-the-review-judge-reads-the-document-as-stored-including says the judge sees rules with examples plus the declared commands. AC-RJI-1 tests only rule ids/statements, glossary terms and depends_on, so it stays green. A judge can therefore report examples or commands as missing. Found while fixing baseline-judge-a-document (BR-960 rewritten to describe the code).

**Expected:** The judge input for a baseline node includes each rule's examples and the node's declared commands, and a criterion fails if either is absent.
**Actual:** Neither examples nor commands appear in the judge input; no criterion checks them.

Reported by: agent:blfix-D
