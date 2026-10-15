---
id: BASE-147
type: baseline
role: intent
title: "Push local changes to the remote"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-009, type: supersedes}
---
## Push local changes to the remote

> A maintainer or agent copies this checkout's records to the shared remote corpus, so other machines can see them.

Scope: copying records from the local corpus to the remote. What lands on the remote, and what does not.

### Behaviour

**Command.** Anyone pushes the project.

**Constraint.** Sync must be switched on with an address, and the named token variable must be set. Then the temporary directory must be usable. Only then is the remote contacted.

**Event.** `CorpusPushed` (rows added to the remote; nothing recorded locally).

### Terms used here

- **Push**, **replicated records**, **remote corpus**: defined in the branch glossary.

### Boundary notes

- Push only adds what the remote lacks. It is not a mirror: changes to rows already pushed do not travel (BR-932).
- Reading the remote back is "Pull remote changes".

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Kinds of record pushed | documents, links, version history, audit entries, agent keys | not adjustable | 2026-10-09 |
| Rows sent per batch | 500 | not adjustable | 2026-10-09 |

### Depends on

- Connect a project to a remote corpus: the settings and token variable.
- Issue an agent key, Revoke an agent key: agent keys are among the pushed records.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Push never updates a row the remote already has, so edits, status changes and key revocations made after the first push never arrive. Is push meant to be a mirror? | unconfirmed | product, engineering |
| Q2 | Judgments, calibration, baseline rules and their citations are never pushed, so approval on another machine sees no judgment. Intended? | unconfirmed | product |
| Q3 | Should a push that fails part-way undo what it already sent? | undecided | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-930 | unconfirmed | established | AC-LL-9's test asserts only a non-zero exit, not the exit 1 this rule states (method step 6); a criterion pinning exit 1 is needed before this can be established. |
| BR-932 | unconfirmed | established | Is push meant to make the remote equal to the local corpus? |
| BR-933 | unconfirmed | established | Should revocation reach the remote, and should keys be shared across machines at all? |
| BR-934 | unconfirmed | established | Which of these records should travel with the documents? |
| BR-936 | unconfirmed | established | Should a push leave an audit entry naming who pushed and how much? |
| BR-937 | unconfirmed | established | Should a failed push be undone or resumable? |
