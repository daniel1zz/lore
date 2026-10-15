---
id: TASK-1068
type: task
role: plan
title: "An AC citing a retired rule can be re-cited only through lore ac set (which demotes the spec): lore ac cite refuses both adding and removing"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9ff390b8-2657-4273-b95c-16e463ee5156"}
---

Measured 2026-10-10 on AC-BLS3-12 after BR-424 was retired.

**Expected:** lore ac cite <spec> <AC> <live rule> admits the add (or a --replace form exists) so the citation can be repaired without demoting an approved spec, as BR-87 promises for citing
**Actual:** ac cite <live ids> -> exit 4 'cites BR-424, which is retired'; ac cite BR-424 --remove -> exit 4 'cites no rule'; only ac set --cite (wholesale replace) works, and it demotes the approved spec to draft

Reported by: agent:main-orchestrator
