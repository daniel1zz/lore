---
id: BASE-149
type: baseline
role: intent
title: "Check a turn at its end"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: BASE-027
---
## Check a turn at its end

When an agent's turn ends, one hook looks back over what the main session changed during that turn and either lets the turn end silently or blocks it once with every finding listed, so the agent repairs while the change and its context are still in hand. It replaces checks that used to fire on every single edit (adr-rule-delivery-tiers-gate-hook-skill-and-optimistic, section 2: behavioural checks run at turn end).

Inputs are the per-turn edit record written by the post-edit hook. Edits made inside helper agents are not the main session's and are not counted. Rules land with spec-interception-moves-off-every-tool-call-one-turn-end-review.
