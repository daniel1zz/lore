---
id: BASE-050
type: baseline
role: intent
title: "Accept a decision record"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-002, type: supersedes}
---
## Accept a decision record

> An owner marks a proposed decision record as accepted.

Scope: the one decision-status change the edit command makes. Deprecating and superseding a decision are "Invalidate a document" and "Supersede a document".

### Behaviour

**Command.** An owner sets a decision record's decision status to accepted.

**Constraint.** Only 'accepted' can be written this way (BR-735), and only on a decision record (BR-736).

**Event.** `DecisionAccepted` (a version entry and an audit entry of an ordinary update, unless it was already accepted).

### Boundary notes

- Accepting does not approve the record; approval is review's.
- This action has no failure site of its own in the census: its refusals happen on the command line before the edit is made, and its write is an ordinary edit ("Revise a document").

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Accepting is only on the command line. Is the agent tool route meant to have it? | undecided | product |
