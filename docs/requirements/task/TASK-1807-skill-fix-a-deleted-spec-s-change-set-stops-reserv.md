---
id: TASK-1807
type: task
role: plan
title: "[Skill:fix] A deleted spec's change set stops reserving rules; change-set entries can be withdrawn; foreign refusal names its target kind"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (observed 2026-10-19): a spec's rule change set keeps reserving its rules after the spec is deleted. spec-defect-clusters-round-2-29-root-causes-behind-69-open proposed `modify BR-925` and `modify BR-807`, was then split into four specs and soft-deleted (draft, no evidence). `lore rule propose <part-C spec> modify BR-925 …` and `<part-A spec> modify BR-807 …` now refuse with "BR-925 is already modified" / "BR-807 is already modified": the deleted spec's entries still count, there is no command to withdraw an entry (`rule propose` ops are add|modify|retire|amend; amend only rewrites a proposed add), and a deleted spec can never land, so the two rules can never be changed by any spec.
Also observed: the foreign-corpus refusal text says "this baseline write …" for every refused write, including a task's evidence row (verify regression investigation, 2026-10-19), which misdirects diagnosis.
Approach: (1) a deleted (or deprecated) spec's change set does not reserve rules: the "already modified/retired" check considers only live specs; (2) `lore rule propose <spec> withdraw <BR-n>` removes an entry from a draft spec's change set (locked spec: with --correction), one version, audited; (3) the foreign-provenance refusal names the target kind it refused (task / baseline / document), from the target the decision already has.
AC: (a) after deleting a spec that modifies BR-x, another spec can propose modify BR-x (exit 0); (b) withdraw removes the entry and a second spec can then propose it; (c) a refused task evidence write from an unleased worktree prints "this task write" not "baseline write". Runner-produced red.
