---
id: TASK-729
type: task
role: plan
title: "lore list silently omits invalidated docs and reports a self-consistent total, so a corpus-wide census is wrong by exactly the hidden population with no signal that anything was filtered"
status: draft
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PRD-001
---
This is the mirror face of the existing lesson 'a listed doc is NOT proven live — validity is authoritative only by direct address'. The unlisted direction is worse, because it is undetectable: a doc absent from every list is not proven absent, and nothing in the output says a filter ran. The default filter is defensible; the SILENCE is the defect. Two cheap fixes, either sufficient: report the omitted count alongside total (as lore bootstrap already does for its own trimming ledger), or make total the unfiltered population and let docs carry the filtered view. Cross-checking against Get a document by ID or slug (lore get v0.1.0)

USAGE `lore get [OPTIONS] <ID>`

ARGUMENTS

  `ID`    Document ID or slug    

OPTIONS

  `--json`    Output as JSON     
   `--raw`    Skip MDX resolution cannot save the caller — you only think to address a doc directly if you already suspect it exists.
