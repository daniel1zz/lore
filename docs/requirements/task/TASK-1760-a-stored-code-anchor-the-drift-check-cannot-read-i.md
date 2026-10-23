---
id: TASK-1760
type: task
role: plan
title: "A stored code anchor the drift check cannot read is reported as a finding, never skipped"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Source: review of baseline-detect-code-anchor-drift, 2026-10-19 (design_necessity, class c, silent fallback). BR-416: a stored code anchor that fails to parse is dropped by the drift check with no finding (packages/lore/src/service/drift-check-service.ts, extractParsedCodeAnchors: `if (result.ok) parsed.push(...)`, else nothing), so a document whose every anchor is unreadable counts as having none and the run can exit 0. The comment justifies it as "grammar is guaranteed at every write seam", but a hand-edited, imported or legacy row reaches the scan anyway.

End state: an unreadable stored anchor is a drift finding of its own kind (naming the document, the raw stored string and the parse reason), failing the run with exit 3 like every other finding, and counted in the per-status anchor counts. Never silently dropped. Restate BR-416 to the reported behaviour and close Q2 of the leaf.

AC: red-first. A spec whose extra.code_anchors holds one string the anchor grammar rejects: the drift check reports it as an unreadable-anchor finding and exits 3. Falsifier: today's silent skip with exit 0.
