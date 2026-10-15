---
id: BASE-131
type: baseline
role: intent
title: "List agent keys"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-010, type: supersedes}
---
## List agent keys

> An operator sees which agents hold keys and which keys still work.

Scope: listing keys. Nothing changes.

### Behaviour

**Command.** An operator lists keys.

**Constraint.** None.

**Event.** None (a read).

### Current values

None.

### Depends on

- Issue an agent key, Revoke an agent key: the keys listed.

### Open questions

None.


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-954 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
