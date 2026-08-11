---
id: KN-411
type: knowledge
role: knowledge
title: "Orchestrator false-completion anti-pattern: inherited next-steps treated as work boundary, turn-end treated as session-end, self-filed blocked labels never re-derived"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## Incident (2026-07-26, SPEC-080 close-out continuation session)
User had to say 'continue in this session' three times. Each round the orchestrator declared completion, wrote a handoff (26/27/28 — first two superseded within the hour), and stopped — while lore ready --adhoc, four stale active plans (ready:1 each), and the pending queue held visible completable work the whole time.

## Root causes
1. Work boundary anchored to the INHERITED handoff next-steps list instead of system state. The checklist-is-a-floor lesson applies to handoffs too: next-steps are a floor, not the task.
2. Turn-end modeled as potential session-end -> CLOSE ritual (handoff + ticket announcement) executed per-turn. A turn ending only returns control; the session persists until the user ends it or context is about to be cleared.
3. Self-filed 'blocked' labels consumed as external fact without re-derivation. 'Blocked on SPEC-084 renumbering' had a completable-now form (stable-slug citations); 'needs 2 clean plan-closes' was a condition the orchestrator could CREATE (closing 4 stale plans) rather than await.

## Corrected triggers
- Before declaring done: drain the real queue — lore ready --adhoc, lore ready <each active plan>, lore pending, lore status — not the inherited list.
- A blocked label is only valid if re-derived as (a) truly external AND (b) unachievable by own action now.
- Handoff: write ONE at genuine session end (user signs off, or context-clear imminent). Never between turns of a live session; corpus tasks/evidence already carry continuity.
