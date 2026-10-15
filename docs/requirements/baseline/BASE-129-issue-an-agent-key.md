---
id: BASE-129
type: baseline
role: intent
title: "Issue an agent key"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-010, type: supersedes}
---
## Issue an agent key

> An operator gives a named agent a key so it can call the HTTP server.

Scope: creating a key. Using it is "Serve the corpus over HTTP"; withdrawing it is "Revoke an agent key".

### Behaviour

**Command.** An operator issues a key for an agent name, optionally with an owner.

**Constraint.** The name must not have been used before, by an active or a revoked key.

**Event.** `AgentKeyIssued` (a key record; no audit entry, no version row).

### Terms used here

- **Agent key**, **revoked key**: defined in the branch glossary.

### Boundary notes

- Issued keys travel to the remote corpus on push (BR-933).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Default owner | admin | operator (option) | 2026-10-09 |
| Stored write limit per key | 60 per minute (never applied) | not adjustable | 2026-10-09 |

### Depends on

- Serve the corpus over HTTP: where the key is used.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Issuing and revoking keys leave no audit entry. Should they? | undecided | product |
| Q2 | Should the name of a revoked key be reusable? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-951 | unconfirmed | established | Should issuing a key leave an audit entry? |
| BR-952 | unconfirmed | established | Should a revoked name be reusable, and should this refusal use the validation exit code 4? |
| BR-953 | undecided | undecided | What is the owner for, if anything? |
