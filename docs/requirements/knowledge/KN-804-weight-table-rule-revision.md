---
id: KN-804
type: knowledge
role: knowledge
title: "Weight table: rule revision"
status: deprecated
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: ADR-064
---
> ⚠ INVALIDATED 2026-10-28T10:10:16.012Z — superseded by knowledge-weight-table-rule-revision-2; Scored correctness, which the ADR requires to be a gate, not a weight; never used by a decision

Weights for scoring options in a decision that revises a business rule (lore rule set, rule add, rule propose). Kind fixed by the command (adr-an-agent-s-decision-between-milestones-is-a-record-gates; spec-a-decision-carrying-write-records-its-decision-on-its, BR-1482).

Dimensions:
- correctness: the rule states what the code does, checked against code or a criterion run.
- falsifiability: a check-decided criterion can be written that fails when the rule is false.
- clarity: a reader not involved in the change understands it on one read.
- scope: the change touches only what the decision needs.

Weights start equal and are unvalidated: no outcome data exists yet. A weight changes only by a recorded decision that cites a milestone-review drill-down or a traced issue (lore decision rates).
