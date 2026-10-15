---
id: BASE-143
type: baseline
role: intent
title: "Pull remote changes"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-009, type: supersedes}
---
## Pull remote changes

> A maintainer or agent brings the shared remote corpus's changes into this checkout's corpus file.

Scope: catching the local corpus file up with the remote.

### Behaviour

**Command.** A maintainer or agent runs `lore pull` in the project.

**Constraint.** The same settings check as push (BR-938), then the temporary-directory check (BR-939), then the remote is contacted. A remote that cannot be reached or refuses the token ends the pull with exit 1 (BR-941).

**Event.** `CorpusPulled`: the local file is caught up as a replica of the remote and the pull exits 0; nothing is recorded, no audit entry and no version row (BR-940).

### Boundary notes

- Pull is not the reverse of push: push copies rows, pull catches the local file up as a replica of the remote.

### Current values

None adjustable beyond the sync settings.

### Depends on

- Connect a project to a remote corpus: the settings and token variable.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | What happens to local records never pushed when the local file is caught up as a replica of the remote (BR-940)? Not measured: no remote was contacted. | undecided | engineering |
| Q2 | Should a pull leave an audit entry (BR-940)? | undecided | product |
| Q3 | Can a failed pull leave the local file partly caught up (BR-941)? Pull does not undo or check it. Not measured: no remote was contacted. | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-10, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-938 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. (AC-LL-9 covers push only) |
| BR-939 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. (AC-LL-4 covers push only) |
| BR-940 | unconfirmed | established | Q1: what happens to local records that were never pushed? Q2: should a pull leave an audit entry? |
| BR-941 | unconfirmed | established | Q3: can a failed pull leave the local file partly caught up? |
