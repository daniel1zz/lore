---
id: KN-801
type: knowledge
role: knowledge
title: "Weight table (document revision)"
status: approved
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: ADR-064
links:
  - {id: KN-803, type: supersedes}
---
Weights for scoring options in a decision that revises a spec, decision record, baseline node or criterion (lore set on a non-draft target, lore baseline set-label|depends|glossary|map, lore ac add|set|rm|supersede|cite|exempt). Kind fixed by the command (adr-an-agent-s-decision-between-milestones-is-a-record-gates; spec-a-decision-carrying-write-records-its-decision-on-its, BR-1482). Replaces knowledge-weight-table-document-revision, which scored accuracy and consistency: a property whose failure alone must stop a decision is a gate, never a weight (the ADR), and both are already checked (an S..C premise, the milestone re-check, the review judge).

Scored dimensions (only properties that may trade off against each other):
- clarity: a reader not involved in the change understands it on one read.
- scope: the change touches only what the decision needs.
- completeness: the change covers every place that states the same fact.

Weights start equal and are unvalidated: no outcome data exists yet. A weight changes only by a recorded decision citing a milestone-review drill-down or a traced issue (lore decision rates).
