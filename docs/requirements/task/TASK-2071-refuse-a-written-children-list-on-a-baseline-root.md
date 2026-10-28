---
id: TASK-2071
type: task
role: plan
title: "Refuse a written children list on a baseline root, branch or section"
status: draft
priority: medium
phase: "P3 Refusal and change batch"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
links:
  - {id: TASK-2078, type: blocks}
  - {id: TASK-2109, type: blocks}
---
Covers: AC-CL-3
Approach: on create and revision of a baseline node whose kind is root, branch or section, the literal 'if (isBaselineParent(input) && hasAuthoredChildrenHeading(nextContent)) return refuseAuthoredChildren(' (falsifier) refuses with exit 4; This task creates baseline-generated-parts.ts with CHILDREN_HEADING (the spec's exact literal: Children, Children (from the tree), The <n> branches|sections; a heading such as How children are ordered is accepted) and hasAuthoredChildrenHeading. Leaves are not affected. The shipped branch.md template loses its Children table and SKILL.md's node table says children are generated from the tree; verify from a fresh consumer install (lore setup into a temporary HOME). Note: this corpus's 20 parents keep their written lists until the shared migration batch (plan 409's last task) is approved; any revision of one of them before that must remove its list in the same write.
