---
id: TASK-1143
type: task
role: plan
title: "Site census does not follow dependency-injected calls, so refusal sites behind injected functions are missing from a command's census"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"census-honesty","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d4a279d2-1d84-475e-b7a7-8bae738dfd7a"}
---

Found by the R4 site mapper (plan-baseline-fast-mode-migration-of-the-remaining-9-branches). Same silent-incompleteness class as #94.

**Expected:** The census reaches refusal sites behind functions passed in by dependency injection (e.g. uat record's createUatDoc / addLink), or reports them as not measured
**Actual:** After the #94 fix, 'baseline sites "uat record"' omits CorpusService._createImpl's extra.sub_type site and the store's insertWithProvenance/addLink sites because they are reached through injected functions; baseline rules BR-562/BR-563 therefore map to no site under this command, and coverage still reports complete. CLI-level exits (unreadable --json-file exit 2, UAT service unavailable exit 1) are also not census sites

Reported by: agent:main-orchestrator
