---
id: TASK-508
type: task
role: plan
title: "T3 lore handoff coverage-check verb — sole parser and grammar owner"
status: archived
priority: medium
phase: "enforce"
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PLAN-100
plan: PLAN-100
links:
  - {id: TASK-506, type: blocks}
  - {id: TASK-507, type: blocks}
---
## Objective

Land `lore handoff coverage-check` — the SOLE parser of both the ticket render and the disposition line, and the sole owner of the grammar (spec D9).

## Deliverables

- The verb in `packages/lore/src/adapters/cli/commands/handoff.ts`, taking the two Stop-payload read channels.
- Reconstructs the item-id set by reading back the ticket THIS binary printed, from the transcript path.
- Reads the disposition line from the last-assistant-message channel.
- Exits non-zero naming exactly the undispositioned ids on stderr; exits 0 when complete; exits 0 when no ticket is present (D6).

## ACs

AC-RC-7 (three-way, set equality on stderr) and AC-RC-9 (round-trip identity).

## Constraints

Spec D8: **zero cross-process state**. Do NOT route anything through `assets/hooks/lib/turn-state.mjs` — measured 2026-07-30, `resolveSessionId` reads `CLAUDE_SESSION_ID`, which is UNSET in this harness (73 of 73 state dirs are `ppid-` named), and a Stop hook resolves a different ppid than a Bash-tool child, so side-written state is silently invisible.

Channel discipline is not stylistic: the transcript for the EARLIER-turn ticket, last-assistant-message for the CURRENT-turn disposition line. The transcript newest entry may be unflushed — `stop-doc-sync.mjs` records a false block caused by exactly that race.

Depends on T1 constants and on T2 render format. Do NOT write the hook; T5 owns it.
