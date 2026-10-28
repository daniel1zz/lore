---
id: TASK-980
type: task
role: plan
title: "ac set --correction: audited fix of one criterion on a locked spec"
status: archived
priority: medium
phase: "criterion-correction"
created: 2026-10-12
updated: 2026-10-25
tags: []
parent: PLAN-158
plan: PLAN-158
---
Covers AC-CC-1..4 of spec-a-criterion-of-a-locked-specification-can-be-fixed-as-an (D1-D5). AcService.setCriterion: opts.correction {reason}; empty/whitespace reason -> VALIDATION_ERROR field correction.reason before any read/write; on a locked spec skip ONLY recordLock.assertEditable and the approved->draft demotion; all other validations (missing path, falsifier, cites, oracle_generation bump) run unchanged; change_summary 'Correction: <reason>' and audit details.correction {reason} exactly as CorpusService.set writes them, so get's countCorrections counts it. addCriterion/removeCriterion unchanged. CLI ac set --correction (argv-level exit 2 on empty reason, before app load; stdout '(correction recorded: <reason>)'); ac add/rm --correction -> exit 2 naming 'lore ac set --correction'. The record-edit refusal for a criteria edit names 'lore ac set ... --correction'. Prose: extend root CLAUDE.md's Document Lifecycle 'Exits:' sentence and the ac-add|set|rm standing lesson IN PLACE (~250 bytes headroom; lore status --check-claude-md must exit 0); produce-rule asset sentence; regenerate assets manifest; refresh installed rule. Red-first expected-fail evidence at the red run.
