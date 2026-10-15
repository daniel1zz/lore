---
id: TASK-955
type: task
role: plan
title: "lore ready --json .records includes archived rows, so len(records) is not the ready count"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tool-quirk","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"607ded52-5b2e-489b-bc2e-37865ffbf20c"}
---

Consumers must filter record.ready === true; a naive count over .records over-reports readiness (user-04 / user-17 prose). Documented today only as prose in the user layer (D4 of spec-rule-store-git-tracked-fragment-selection-on-demand-skill): the prose stays until this is fixed.

**Expected:** The JSON exposes a ready count or a ready-only list, or names the field so it cannot be read as the ready set
**Actual:** len(.records) counts archived tasks

Reported by: agent:session-e25636da
