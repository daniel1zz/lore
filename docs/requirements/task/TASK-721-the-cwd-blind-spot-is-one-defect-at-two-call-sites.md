---
id: TASK-721
type: task
role: plan
title: "The cwd blind spot is one defect at two call sites: both derive the working directory by regexing a 'cd' prefix this repo's own discipline forbids"
status: archived
priority: critical
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PLAN-079
plan: PLAN-079
---
Adopts the two filed reports 01KZV3XFFY7SEZ9E11NZDC81W8 and 01KZVPHGEMFYWRW3JYB8RYP8F1,
which have no plan and therefore no owner.

Both are the same defect at two call sites: a precheck that parses the command string
looking ONLY for a literal `cd <dir> &&` prefix in order to derive the directory the
command will run in.

- `extractCdPrefixTarget` — used by the oracle-file-existence precheck, so a command that
  names a repo-root-relative test path with no `cd` prefix is refused as naming a
  nonexistent file (AC-OX-4's territory: "refuse a script-mode command naming a
  nonexistent test path").
- `commandRunsFileUnfiltered` — used by `lore done`'s unfiltered-run floor, with the same
  single-syntax assumption.

## Why this is a discipline conflict, not a parsing nit

This repo's own CLAUDE.md forbids putting `cd` in front of a measurement (zoxide shims it,
and a following `&&` then short-circuits silently — it is a recorded false-oracle vector).
So the command shape the discipline REQUIRES is exactly the shape both prechecks cannot
parse. Obeying the rule makes a task un-archivable; disobeying it re-arms a known false
oracle. Measured 2026-08-12/13 across two sessions.

This is precisely what this spec means by "a runner's discovery refusal is not a
measurement, and must never mint a red": the precheck is not measuring whether the file
exists, it is reporting that it could not determine the working directory — and then
returning that as a refusal.

## Scope

Derive the working directory from something other than a prefix pattern in the command
string. A cwd the caller already knows (the claim's `worktree`, the verify execution root)
is a measured fact; re-deriving it by regexing the command is a guess that happens to be
right for one syntax.

⛔ Do NOT fix this by widening the regex to accept more `cd` spellings — that keeps the
guess and merely moves the boundary. And ⛔ do not fix one call site: the two were filed
separately and the second exists because the first was fixed alone.

⚠ BLOCKED ON PLAN PROMOTION: `plan-land-oracle-executability-the-discovery-refusal-primitive`
is still `draft`, so this task cannot be claimed until the plan-promote gate passes on it.
That is a real precondition, not a formality — do not work around it.
