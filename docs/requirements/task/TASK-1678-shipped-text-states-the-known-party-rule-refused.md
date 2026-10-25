---
id: TASK-1678
type: task
role: plan
title: "Shipped text states the known-party rule: refused unattested writes, and how a person registers a human session"
status: archived
priority: medium
phase: "P2"
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PLAN-221
plan: PLAN-221
---
P2 of the plan: shipped text still describes an unattested write as something that happens (assets/skills/lore-session-review/references/invariants.md:75). Under BR-1351 a write with no known party is refused; only rows written before the change can show 'attested: unattested'. Update that invariant, and add to the shipped lore skill (assets/skills/lore/SKILL.md) how a person writes by hand: lore session start --human <name> / lore session show / lore session end, and that an agent's writes carry the run its integration attests (lore setup). Regenerate the assets manifest. Oracle: the assets SSOT/manifest checks and check:floor pass; grep shows the new instructions in the shipped skill.
