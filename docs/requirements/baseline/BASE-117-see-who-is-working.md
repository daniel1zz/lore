---
id: BASE-117
type: baseline
role: intent
title: "See who is working"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-027
links:
  - {id: SPEC-095, type: supersedes}
---
## See who is working

> Before touching another session's work, a session checks whether that session is still running, from the process behind it rather than from how old its claims are.

Scope: listing sessions and showing one, with liveness. The ownership of branches is "See who owns each branch".

### Behaviour

**Command.** A session lists every session at work, or shows one by session id or identity.

**Constraint.** Before answering, the caller registers its own heartbeat. Liveness is decided by probing each session's recorded process on this machine.

**Event.** None in the corpus. The caller's heartbeat file on the local machine is written or replaced.

### Terms used here

- **Active session**, **stale**, **heartbeat**, **liveness**: defined in the branch glossary.

### Boundary notes

- The sessions listed are the same as the snapshot's (BR-324).
- A session becomes measurable to others only after it has itself listed or shown sessions on this machine.

### Depends on

- execution, "Claim a task": the claims the sessions come from, with their session id and machine.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The heartbeat records the short-lived process that ran the command, so a running agent session reads as dead to its peers. How should the session's own long-lived process be captured? | unconfirmed | engineering |
| Q2 | Showing by identity returns the first matching session when one identity has several. Should it list them all? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-386 | unconfirmed | undecided | How should the session's own long-lived process be captured so that alive means the session is running? |
| BR-387 | unconfirmed | established | Should showing by identity print every session of that identity? |
| BR-388 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-382, BR-384, BR-385. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
