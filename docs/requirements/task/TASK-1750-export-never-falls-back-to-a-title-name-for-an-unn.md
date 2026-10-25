---
id: TASK-1750
type: task
role: plan
title: "Export never falls back to a title name for an unnumbered spec or decision record"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Source: review of baseline-export-documents-to-files, 2026-10-19 (design_necessity, class d, legacy/compat state). BR-1284: a spec or decision record that has no number yet is exported under a name built from its title, and the export report carries a warning naming `lore migrate ordinals` (packages/lore/src/service/export-docs-service.ts, buildOrExtendIndex ordinal fallback and `ordinal_warnings`; module header lines 41-53 call it the "pre-`lore migrate ordinals` legacy"). Creation always allocates the number for a numbered kind (corpus-service.ts, `shouldAllocateOrdinal` in create; the kind-flip allocation in set), so the unnumbered state exists only in a corpus that predates the ordinal migration.

End state: every spec and decision record of a numbered kind carries its number before any reader sees it: the corpus upgrade numbers them (the same upgrade path that opens an older corpus, "Upgrade the corpus in place"), so export needs no title-based fallback name and no migration warning. A numbered-kind document found without a number at export is a corpus integrity failure and is refused loudly (naming the documents), never exported under an invented or fallback name. Kinds that never get a number (for example a domain-overview spec) keep exporting without one, as product semantics. Restate BR-1284 accordingly; remove `ordinal_warnings` or reduce it to the refusal.

AC: red-first. A corpus holding a numbered-kind spec with no number: export refuses (exit 4) naming it, and writes no file and no index; after the upgrade step the same export succeeds with the allocated number. Falsifier: today's title-named file plus warning, exit 0. A domain-overview spec still exports with no number and no warning.
