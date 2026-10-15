---
id: TASK-1127
type: task
role: plan
title: "Site census silently drops refusal sites deeper than 12 calls, so a leaf can read complete while missing them"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"oracle-blind-spot","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c278b769-5174-4436-ba5b-796f4512a3e2"}
---

SiteCensus.handleCall (packages/lore/src/service/site-census.ts:634) returns without recording anything when depth >= MAX_CALL_DEPTH (12, line 64). Every refusal site reachable only through a deeper call chain is absent from the census and is neither listed as not-measured nor counted, so 'lore baseline coverage' can exit 0 for a leaf that does not account for it. Baseline rule BR-659 (established, baseline-measure-completeness) states the census lists 'every refusal site a command can reach'; this cutoff makes that claim false for deep chains. Distinct from #104 (injected functions) and #94/#60 (resolution and node_modules layout). Found by the review judge on baseline-measure-completeness, confirmed by reading the code.

**Expected:** A call chain cut at the depth limit is recorded as one not-measured site naming where it stopped, so completeness cannot pass over it silently
**Actual:** Calls at depth 12 are not followed and leave no trace in the census or the coverage verdict

Reported by: agent:blfix-C
