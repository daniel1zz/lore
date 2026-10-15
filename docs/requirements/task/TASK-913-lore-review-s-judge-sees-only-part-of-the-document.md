---
id: TASK-913
type: task
role: plan
title: "lore review's judge sees only part of the document under review and still returns approve, labelling a dimension 'visible portion'"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"judge-input-truncation","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"82b5bc58-a2c5-4a5e-b190-066b2403b153"}
---

Reviewing a 17.6KB domain-overview spec (spec-product-baseline-architecture-trees-the-product-s-current), the judge returned 'Decision: approve (confidence: 0.70)' while its own completeness dimension read 'completeness (visible portion) ... Non-goals are cut off mid-table, and five ...' — i.e. it judged a truncated copy of the doc being reviewed (not the parent spec; that case is the separate existing report about parent truncation). An approve verdict over text the judge never saw certifies unseen content, and nothing in the verdict marks it partial except prose inside one dimension. lore approve then accepts that judgment as the review record.

**Expected:** Either the judge receives the whole document under review, or the judgment records machine-readably that input was truncated (chars seen / total) and an approve verdict over truncated input is refused or downgraded to a non-certifying state.
**Actual:** Decision: approve; dimension 'completeness (visible portion)' states the non-goals table is cut off; no structured truncation flag in the output.
**Repro command:** `lore review spec-product-baseline-architecture-trees-the-product-s-current --ai   # in the lore repo; doc is ~17.6KB`

Reported by: agent:main-orchestrator
