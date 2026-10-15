---
id: BASE-145
type: baseline
role: intent
title: "Connect a project to a remote corpus"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-009, type: supersedes}
---
## Connect a project to a remote corpus

> A maintainer points the project at a shared remote corpus, so its records can be pushed and pulled.

Scope: writing the sync settings, and what the rest of the product does with them once written. Showing them is "See the sync settings"; moving records is "Push local changes to the remote" and "Pull remote changes".

### Behaviour

**Command.** A maintainer gives the remote corpus address, optionally the name of the environment variable that holds its access token, and optionally an interval.

**Constraint.** The address must start with libsql://, and the command must run inside a project. Only the variable's name is stored, never the token. Nothing checks that the token is set or that the remote answers.

**Event.** `SyncConfigured` (the project settings file is rewritten; no audit entry, no version row).

### Terms used here

- **Sync settings**, **access token variable**, **remote corpus**, **local corpus**: defined in the branch glossary.

### Boundary notes

- The settings are read by push and pull (BR-930, BR-938) and shown by status.
- Every other command, the HTTP server included, ignores them (BR-925).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Default access token variable name | LORE_SYNC_TOKEN | maintainer, per project (option) | 2026-10-09 |
| Default interval | 60 seconds | maintainer, per project (option) | 2026-10-09 |
| Sync in a new project | not configured (local only) | maintainer | 2026-10-09 |

### Depends on

- corpus: the project's corpus file must exist (lore init).
- distribution: the project settings file.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should switching sync on make the other commands work against the remote, or at least warn that they do not (issue 84)? Two live criteria (AC-LL-8, AC-LL-10 of the libsql lazy-load spec) currently pin the opposite: corpus commands must keep ignoring sync. | unconfirmed | product |
| Q2 | Should setup check that the token variable is set and that the remote answers before reporting success? | undecided | product |
| Q3 | Should an unusable interval be refused instead of silently replaced by 60? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-920 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-921 | unconfirmed | established | Should the sync commands resolve the corpus the way every other command does (worktree to main checkout)? |
| BR-922 | unconfirmed | established | Should writing the sync settings leave an audit entry, given it changes where the team's records go? |
| BR-923 | undecided | undecided | Should setup verify the token and reach the remote before reporting success? |
| BR-924 | unconfirmed | established | Should an unusable interval be refused with a usage error? |
| BR-925 | unconfirmed | established | Should corpus commands use the remote when sync is on, or warn that they do not? AC-LL-8 and AC-LL-10 currently pin this behaviour as intended. |
| BR-926 | unconfirmed | established | Should a malformed sync section fail every command loudly, and should setup be able to overwrite it? |
