---
id: KN-802
type: knowledge
role: knowledge
title: "Weight table (rule revision)"
status: approved
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: ADR-064
links:
  - {id: KN-804, type: supersedes}
---
Weights for scoring options in a decision that revises a business rule (lore rule set, rule add, rule propose). Kind fixed by the command (adr-an-agent-s-decision-between-milestones-is-a-record-gates; spec-a-decision-carrying-write-records-its-decision-on-its, BR-1482). Replaces knowledge-weight-table-rule-revision, which scored correctness: a property whose failure alone must stop a decision is a gate, never a weight (the ADR), and it is already gated (meaning-unchanged, an S..C premise, the milestone re-check).

Scored dimensions (only properties that may trade off against each other):
- falsifiability: a check-decided criterion can be written that fails when the rule is false.
- clarity: a reader not involved in the change understands it on one read.
- scope: the change touches only what the decision needs.

Weights start equal and are unvalidated: no outcome data exists yet. A weight changes only by a recorded decision citing a milestone-review drill-down or a traced issue (lore decision rates).
