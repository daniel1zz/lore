---
id: TASK-685
type: task
role: plan
title: "Close the MCP side door that stores a grammar-invalid knowledge code_anchors entry as a silent false green"
status: draft
priority: medium
phase: "reachable-facts"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-126
plan: PLAN-126
---
New defect the M2 implementer verified while landing knowledge anchors, outside its anchors so it could only flag it. corpus-service.ts:1067 (create) and :1955 (set) gate the per-entry code_anchors grammar check on type === 'spec' only. MCP lore_create/lore_set accept extra directly (tools.ts:267,341 -> :1292,2705), so a knowledge doc can store a grammar-invalid code_anchors entry through that door: extractParsedCodeAnchors silently skips it, so lore anchor list SHOWS the anchor while it contributes nothing to drift detection. That is exactly the silent-false-green class the governing spec exists to close, reintroduced one layer down. Not reachable via the CLI (lore set has no --extra) — the fix belongs at the service check, not the adapter, so every surface inherits it. ⛔ Blocked on the sub-type-filter task merging: both files are in its anchors.
