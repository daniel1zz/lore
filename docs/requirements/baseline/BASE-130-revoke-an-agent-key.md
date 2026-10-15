---
id: BASE-130
type: baseline
role: intent
title: "Revoke an agent key"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-010, type: supersedes}
---
## Revoke an agent key

> An operator withdraws an agent's key so it can no longer call the HTTP server.

Scope: revoking a key on this checkout's corpus.

### Behaviour

**Command.** An operator revokes the key of a named agent.

**Constraint.** The name must have been issued.

**Event.** `AgentKeyRevoked` (the key record is marked; no audit entry).

### Boundary notes

- A key revoked after it was pushed stays valid on the remote (BR-933).

### Current values

None.

### Depends on

- Issue an agent key.
- Serve the corpus over HTTP: where the revocation takes effect.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | An unknown name exits 1 rather than the not-found exit 3 other commands use. Intended? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-955 | unconfirmed | established | Should revoking a key leave an audit entry? |
| BR-956 | unconfirmed | established | Should this use the not-found exit 3 and name the agent? |
| BR-957 | undecided | undecided | Should a repeated revocation keep the first time, or be refused? |
