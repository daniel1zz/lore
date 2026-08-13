---
id: TASK-728
type: task
role: plan
title: "lore done tells you to archive a plan whose declared phases are mostly EMPTY: 'every child task is archived' cannot distinguish a finished plan from one that was never decomposed"
status: draft
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PRD-001
---
Third instance this session of the same family: a governance surface renders an unsound state identically to a sound one, and then prints the write command that acts on it. The signal lore done uses is 'no non-terminal child tasks remain'. That predicate is satisfied trivially by a phase containing zero tasks, so a plan is judged finishable on the basis of work that was never planned. The fix belongs where the message is generated, not in reviewer vigilance: compare tasks-per-declared-phase before emitting the suggestion, and when a declared phase has no members, say so instead of suggesting archival. Adjacent, from the same measurement: the plan's own spec carries three acceptance criteria with ZERO evidence (AC-OX-6, AC-OX-7, AC-OX-11) that map precisely onto the two empty phases — so the AC layer already holds the evidence that the plan is unfinished, and the close suggestion does not consult it.
