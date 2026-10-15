---
id: BASE-146
type: baseline
role: intent
title: "See the sync settings"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-009, type: supersedes}
---
## See the sync settings

> A maintainer or agent checks whether this project syncs, and with which settings.

Scope: showing the sync settings. It reports what the settings say; it does not test the token or the remote.

### Behaviour

**Command.** Anyone asks for the sync status of the project.

**Constraint.** Must run inside a project with readable settings.

**Event.** None (a read).

### Boundary notes

- The settings are written by "Connect a project to a remote corpus".
- "Enabled" here means only that the settings say so; whether push and pull will work is decided when they run (BR-930).

### Current values

None.

### Depends on

- Connect a project to a remote corpus: the settings shown.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should status say whether the token variable is set (without showing it) and whether the remote answers? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-927 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-928 | undecided | undecided | Should status report whether push and pull can actually run? |
| BR-929 | unconfirmed | established | Should the message name the faulty setting? |
