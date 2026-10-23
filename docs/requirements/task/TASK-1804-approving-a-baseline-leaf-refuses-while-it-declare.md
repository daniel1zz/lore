---
id: TASK-1804
type: task
role: plan
title: "Approving a baseline leaf refuses while it declares a command absent from main, and status lists absent declarations"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Decision (user, 2026-10-19): a declared command that does not exist in the analysed tree is reported but does not fail coverage, so a branch can declare its new command in the shared corpus before it lands without blocking every other integrate (incident 07:38: a pre-declared `refs` made check:baseline-coverage exit 2 for all other branches). The coverage side is delivered by task-root-coverage-reports-a-declared-command-that-no-longer (absent_commands, reported, never failing).

That leaves stale declarations (a branch abandoned or a command removed) unrefused. End state for this task — the refusal moves to where a leaf is vouched for:
1. `lore approve <baseline leaf>` (and the branch/root containing it) refuses, exit 4, while the leaf declares a command absent from main's tree, naming each one and the fix `lore baseline map <leaf> --remove-command "<cmd>"`. Measured with the same census entry resolution as coverage (one predicate), against the shared checkout's main tree.
2. `lore status` lists every leaf with absent declared commands (count in the summary, names in detail and in --json), so a stale one is visible every session, never silent.

AC: red-first tests — (1) approving a leaf that declares `gamma` absent from the registry exits 4 naming gamma and the fix; after the declaration is removed, approval proceeds. (2) `lore status --json` carries the leaf and command; text shows the count. Falsifier: today's approve succeeds and status is silent.
