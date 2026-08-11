---
id: TASK-343
type: task
role: plan
title: "Refuse a self-reported evidence command containing a shell pipe, since its exit code belongs to the last stage"
status: archived
priority: high
phase: "mechanisms"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-081
plan: PLAN-081
---
Per the governing spec M2.

`lore evidence` must refuse a SELF-REPORTED row whose `--command` contains a shell pipe. Rationale: `$?` after a pipe is the LAST stage's status, so the recorded `result` cannot have been measured. This session is the THIRD recurrence of the trap (handoff-71 KD2 recorded two; a third occurred here when an implementer's oracle ran `bun run test:changed <base> 2>&1 | tail -100` and would have recorded a pass from tail's exit 0).

Host it as a FIFTH guard beside the four already in `adapters/cli/evidence-precheck.ts`, composed into the existing refusal chain (`findMissingOracleFilesForEvidence`) — ⛔ never a parallel entry point, which would make the rule opt-in per surface.

⛔ The `--capture` path is OUT of scope and must stay byte-identical: there lore spawns the command itself, so the pipe hazard does not apply. AC-FALS-7 asserts the same piped command exits 0 under `--capture` — that CONTROL is load-bearing, a blanket refusal must not pass as green.
