---
id: BASE-096
type: baseline
role: intent
title: "Invalidate a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-102, type: supersedes}
---
## Invalidate a document

> An author retracts a knowledge record, decision record or task from a moment on, or undoes that.

### Behaviour

**Command.** An author invalidates a document, optionally with a reason and a successor, or undoes an earlier invalidation.

**Constraint.** Only a knowledge record, a decision record or a task can be invalidated; any other type is refused with exit code 4 (BR-776, unconfirmed: see Q2 and Q3). A successor must exist (BR-779). Invalidating again keeps the first moment of invalidity, and a moment in the future is refused (BR-778). Undoing needs an invalidation to undo (BR-780).

**Event.** `DocInvalidated`: the document is marked invalid with its reason and successor, one version entry and one audit entry, and its status unchanged (BR-777); a named successor gets a supersedes link, and a decision record becomes superseded, or deprecated when no successor is named (BR-779). Invalidating an archived, deprecated or foreign-claimed task adds a note to the result (BR-781). `InvalidationUndone`: the moment, reason and successor are cleared with a new version and audit entry, and a superseded decision record stays superseded with a note (BR-780).

Undoing an invalidation is covered by one rule, BR-780. Invalidating an already invalid document again (BR-778) is a second invalidation, not an undo.

### Boundary notes

- Invalidation changes visibility in lists and search (BR-745, BR-750) and adds a warning line when read (BR-719).
- Invalidating a document that a staleness probe escalated also records a calibration; that is hygiene's.
- The status of the document is not changed: an approved invalidated document stays approved (BR-777).
- Invalidating is not refused from a linked worktree (BR-806).
- A deleted document can still be invalidated when named directly (BR-782); this is a suspected defect (Q1).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Longest reason | 500 characters | product | 2026-10-09 |
| Types that can be invalidated | knowledge record, decision record, task | product code | 2026-10-10 |

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Suspected defect: a deleted document named directly can still be invalidated (BR-782). Should it be refused as not found? | unconfirmed | product |
| Q2 | Should a requirements document, spec or plan also be retractable? Today they are refused (BR-776). | undecided | product |
| Q3 | No criterion cites BR-776 or BR-781. Which criteria, with tests that fail if the rules are false, should establish them? | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-776 re-read on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-776 | unconfirmed | established | Q3 (no criterion cites it); Q2 asks whether the set of types should widen, which would rewrite it. |
| BR-781 | unconfirmed | established | Q3: its only citation was removed in the 2026-10-09 citation audit, when an independent judge found the citing criterion did not assert the rule's main claim or its test would not fail if the rule were false. |
| BR-782 | unconfirmed | established | Q1: should invalidation refuse a deleted document as not found? |
