---
id: BASE-003
type: baseline
role: intent
title: "Create a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-066
links:
  - {id: SPEC-008, type: supersedes}
  - {id: SPEC-002, type: supersedes}
  - {id: SPEC-017, type: supersedes}
  - {id: SPEC-020, type: supersedes}
  - {id: SPEC-024, type: supersedes}
---
## Create a document

> An author or agent adds a new document of any type to the corpus.

Scope: what every creation shares. The type-specific conditions are in their own leaves: a spec (specification, "Create a spec"), a task (execution, "Create a task"), a plan (execution, "Plan the work"). Creating a document that replaces another is "Supersede a document".

### Behaviour

**Command.** An author creates a document with a type, a title, and optionally a parent, a body, a priority, tags and type-specific details.

**Constraint.** The request must be well-formed for its type (BR-700); the parent must be of an allowed type and must exist (BR-701); two knowledge kinds can only be written by their own actions (BR-704, BR-705). A name is derived from the title (BR-706) and made unique (BR-707). A specification, plan or task can name the filed reports it resolves when it is created; those resolving links are written in the same command, and a name that is not a filed report refuses the whole creation (BR-1083).

**Event.** `DocCreated` (version 1, one version entry, one audit entry naming the acting identity).

### Terms used here

- **Name**, **recorded author**, **acting identity**, **details**: defined in the branch glossary.

### Boundary notes

- Naming resolved reports at creation (BR-1083): this leaf owns only the creation-time request and its refusal; the resolving link itself and what it does to a report are the issue loop's ("Link two documents" writes the same link afterwards).
- Specs, tasks and plans add their own conditions on top of these (BR-1 to BR-14, BR-113 to BR-124, BR-97 to BR-99); they are not repeated here.
- Ledger knowledge kinds (assessment, retro, handoff, acceptance verdict) are approved at creation when the project allows it; that rule is autonomy's.
- The foreign-corpus refusal applies here (BR-802).
- After a creation, a link from the governing skill to the new document may be added; that is context's and never fails a creation.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether AI drafts a missing body on a calling surface | on for people (command line, browser), off for agents | project settings maintainer | 2026-10-09 |
| Longest generated name | 64 characters | product | 2026-10-09 |

### Depends on

- Read a document: resolving the parent reference.
- Keep writes in this checkout's corpus: the refusal that runs first.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The recorded author is 'system' whoever creates the document (BR-703), so the list's author filter finds nothing (BR-747). Should the recorded author be the acting identity? | undecided | product |
| Q2 | Should the request shape be refused with the same exit code on every route? Today the command line refuses with 2 what the other routes refuse as invalid input. | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-700 | unconfirmed | established | Should the same malformed request end with the same exit code on every route? |
| BR-701 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-705 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-707 | unconfirmed | established | Should the name of a deleted document stay reserved forever? |
| BR-708 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-709 | unconfirmed | established | Should a parentless knowledge record or decision record be filed under the requirements document automatically? |


**BR-703 held at unconfirmed after the post-remediation fidelity sample (2026-10-09):** its only citation was judged unfaithful (seed 20261010 sample). Open question: which criterion, with a test that fails if the rule is false, should establish it?
