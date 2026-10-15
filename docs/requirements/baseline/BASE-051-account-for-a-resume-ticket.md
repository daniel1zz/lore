---
id: BASE-051
type: baseline
role: intent
title: "Account for a resume ticket"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-027
links:
  - {id: SPEC-095, type: supersedes}
---
## Account for a resume ticket

> A session that was handed a resume ticket cannot quietly drop part of it: before it stops, every item is either done or deferred to a named place.

Scope: the stop-time check (the coverage-check subcommand of the handoff command), which the stop hook runs. Writing a handoff is "Hand off a session".

### Behaviour

**Command.** When a session tries to stop, its stop hook hands the check the session's record and its last message.

**Constraint.** Only a ticket produced by resuming arms the duty. Every numbered item must have a disposition in a main-chain message after the ticket: done, or deferred with a reason naming a destination.

**Event.** None recorded; the verdict is printed. An incomplete accounting tells the session to continue.

### Terms used here

- **Accounting duty**, **disposition**, **destination**, **ticket item**: defined in the branch glossary.

### Boundary notes

- Which tickets carry the accounting declaration is decided when resuming (BR-349, BR-351).
- Installing the stop hook is distribution's.

### Depends on

- Resume a session: the ticket and its numbering.
- distribution (not yet written): the stop hook that runs the check.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A destination is checked for shape only; a name that looks like a document but names none satisfies it. Should it be looked up? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`), with the branch's three levels: a rule measured in code that no faithful criterion cites is held at observed; a rule whose intended behaviour is open is undecided or unconfirmed.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-360 | undecided | undecided | Should a destination naming a document be required to name an existing one? |
| BR-363 | observed | established | No question about intent; its only citation was judged unfaithful (fidelity sample seed 20261010), so it waits for a check-decided criterion that fails if this is false. |
| BR-365 | observed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |


**BR-363 held at observed after the post-remediation fidelity sample (2026-10-09):** its only citation was judged unfaithful (seed 20261010 sample). Its behaviour is measured in code; what is missing is a criterion with a test that fails if the rule is false.
