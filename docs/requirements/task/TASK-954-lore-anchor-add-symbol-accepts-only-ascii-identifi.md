---
id: TASK-954
type: task
role: plan
title: "lore anchor add #Symbol accepts only ASCII identifiers, so a test describe title cannot be anchored"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tool-quirk","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d1cd5b63-3f3f-4966-b3db-1b5fd0b4dcf6"}
---

lore anchor add <spec> <file>#<Symbol> validates Symbol against /^[A-Za-z_$][A-Za-z0-9_$]*$/; a describe title with spaces exits 4, so AC-to-test traceability stops at the file (user-06 prose). Documented today only as prose in the user layer (D4 of spec-rule-store-git-tracked-fragment-selection-on-demand-skill): the prose stays until this is fixed.

**Expected:** A test anchor can name a describe/it title (quoted), or a documented alternative exists
**Actual:** Any non-identifier symbol exits 4

Reported by: agent:session-e25636da
