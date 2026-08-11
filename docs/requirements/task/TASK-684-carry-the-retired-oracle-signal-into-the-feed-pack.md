---
id: TASK-684
type: task
role: plan
title: "Carry the retired-oracle signal into the feed pack so a dispatched implementer does not read it as plain green"
status: draft
priority: medium
phase: "read-surfaces"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-127
plan: PLAN-127
---
The AC-DC-10 implementer wired lore ac list but deliberately left the feed pack alone and said why: AcceptanceView and renderAcceptanceRow live in flows/task-feed-flow.ts (a file outside its anchors), and that view's coverage field is typed ReturnType<typeof deriveAcCoverageState> — the 7-state union it was forbidden to extend — with no free-form passthrough, so the wiring could only have populated a field that does not exist. It refused to add an unproven capability rather than reproduce the exact gap AC-DC-10 exists to close. ⛔ Do NOT extend deriveAcCoverageState to an eighth state: carry the oracle_generation fact alongside the coverage state, the way commands/ac.ts does. This is the higher-stakes half of the two surfaces — a misleading ac list costs a reader one wrong glance, a misleading FEED pack dispatches an implementer against a retired oracle.
