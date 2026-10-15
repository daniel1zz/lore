---
id: BASE-105
type: baseline
role: intent
title: "Export documents to files"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-021, type: supersedes}
---
## Export documents to files

> A maintainer writes one Markdown file per document, so the corpus can be read and reviewed in the repository.

### Behaviour

**Command.** A maintainer exports all documents, or one type.

**Constraint.** A hand-edited or stale file is not overwritten unless forced (BR-784).

**Event.** `DocsExported` (files and the export index; nothing in the corpus documents).

### Boundary notes

- Checking that exported files match the corpus in the repository's own gate is distribution's and hygiene's.
- Numbers of specs and decision records come from the numbering ("Upgrade the corpus in place").

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The export index is saved before the loop check, so a refused export may still rewrite the index. Should the refusal come first? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-783 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-784 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-785 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-787 | unconfirmed | established | Should the files of deleted documents be removed too? |
| BR-788 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
