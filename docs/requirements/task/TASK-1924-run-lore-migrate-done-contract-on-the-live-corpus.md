---
id: TASK-1924
type: task
role: plan
title: "Run lore migrate done-contract on the live corpus and apply the listed corrections"
status: draft
priority: high
phase: "P2 Migration and foreign-criteria corrections"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1922, type: blocks}
---
Covers: AC-DCS1-26 (the live migration). Kind: corpus (no file changes). Approved only AFTER the one landing of `integration/done-contract-stage-1` (whose own rebuild installed the new binary) and the old-binary `lore done` calls of the plan: while it is a draft it has no kind (`lore set <task> --kind corpus`), and its approval then compiles its contract with the new binary (oracles: AC-DCS1-26 and `corpus:files-unchanged`). The migration is THIS task's work, run by the orchestrator in the shared checkout, so there is no circularity: the task is not listed by the migration (it is a draft until approved).
TDD-Role: none
Approach: `lore migrate done-contract` (preview; it needs no claim) and read the list: tasks of the open plans (#414, #420, #416, #409 and their successors), kind and contract or causes. Run `lore approve <slug> --red-waiver "<reason>"` for every task listed `needs-red-waiver` that really adds no test; fix every uncompilable cause at its source (a missing config key, an unresolved ac_scope id, a stale falsifier literal with `lore ac set --correction`) or leave the task listed for the user; then `lore migrate done-contract --apply`, then a second `--apply` that must write nothing. No approved-to-draft move is made. Then `git checkout --detach main` in the shared checkout (the landing moved main and the detached HEAD did not follow; BR-1342 does not refuse this), `lore finish` of this task there and `lore done`.
Done when: AC-DCS1-26 passes (`lore migrate done-contract` exits 0), or the remaining uncompilable tasks are named in the evidence and accepted by the user, and the second apply wrote nothing.
