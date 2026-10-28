---
id: KN-803
type: knowledge
role: knowledge
title: "Weight table: document revision"
status: deprecated
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: ADR-064
---
> ⚠ INVALIDATED 2026-10-28T10:10:16.306Z — superseded by knowledge-weight-table-document-revision-2; Scored accuracy and consistency, which the ADR requires to be gates, not weights; never used by a decision

Weights for scoring options in a decision that revises a spec, decision record, baseline node or criterion (lore set on a non-draft target, lore baseline set-label|depends|glossary|map, lore ac add|set|rm|supersede|cite|exempt). Kind fixed by the command (adr-an-agent-s-decision-between-milestones-is-a-record-gates; spec-a-decision-carrying-write-records-its-decision-on-its, BR-1482).

Dimensions:
- accuracy: the text states what the product or the decision actually is, checked against its source.
- consistency: the text agrees with the rules, criteria and documents it touches.
- clarity: a reader not involved in the change understands it on one read.
- scope: the change touches only what the decision needs.

Weights start equal and are unvalidated: no outcome data exists yet. A weight changes only by a recorded decision that cites a milestone-review drill-down or a traced issue (lore decision rates).
