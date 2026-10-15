---
id: TASK-1004
type: task
role: plan
title: "Prose: shipped skills and PRODUCE rule name living vs record and the reopen/new-spec path"
status: archived
priority: medium
phase: "prose"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-160
plan: PLAN-160
---
Covers: AC-DR-7, AC-DR-9. Spec: spec-documents-are-living-or-records-a-locked-record-is-never D9, D12. In the five assets, replace the in-place instruction ('update or extend', 'update existing (lore set <spec>)', 'governing spec: lore set <spec>') with the three-way decision: read the spec's Standing in lore get — not locked: edit it; locked without evidence: lore reopen --reason then edit; locked with evidence: create a new spec and lore link <new> <old> --type relates-to. PRODUCE rule (corpus-workflow-2-produce.md): one bullet naming living vs record, the Standing line and the same three-way decision. Regenerate packages/lore/src/generated/assets-manifest.ts. Root CLAUDE.md §Document Lifecycle: rewrite the 'Editing an approved doc resets it to draft' paragraph and the 'lore ac add does NOT demote' asymmetry to state locked records are refused (cite spec + BR-1048/1049) — keep within lore status --check-claude-md budget.
 Also rewrite the standing-lessons line (~170) that says lore ac set demotes and ac add does not ("see the asymmetry above"): both are now refused on a locked spec.
