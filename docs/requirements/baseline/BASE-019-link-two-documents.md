---
id: BASE-019
type: baseline
role: intent
title: "Link two documents"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-066
links:
  - {id: SPEC-008, type: supersedes}
  - {id: SPEC-002, type: supersedes}
  - {id: SPEC-019, type: supersedes}
  - {id: SPEC-022, type: supersedes}
---
## Link two documents

> An author records a typed relation from one document to another.

### Behaviour

**Command.** An author links document A to document B with a link type, or lets an AI choose the type (BR-762).

**Constraint.** The type must be known and the link new (BR-756); a parent link must respect the filing rules and must not loop (BR-758), and a parent link from a spec is always refused, since a spec takes no parent (BR-1025, the link half of BR-2). A link of any type other than parent or resolves is not checked against its documents, so a document can be linked to itself or to a deleted document (BR-761, suspected defect).

**Event.** `DocLinked` (an audit entry on A naming B and the type, with the acting identity; no version entry) (BR-757, BR-760).

### Boundary notes

- The resolves link, from a fixing document to an issue task, has its own condition; it is issue-loop's.
- The governs link from a skill to the documents it governs is context's.
- The foreign-corpus refusal applies here (BR-802).
- The suspected defects in BR-759 and BR-761 are reported in issue #100.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A second parent link moves the document and keeps the old link (BR-759). Should adding a parent replace the old parent link? | unconfirmed | engineering |
| Q2 | Should a parent change be part of the document's version history (BR-760)? | undecided | product |
| Q3 | Links of a type other than parent or resolves are accepted to self and to deleted documents (BR-761). Should they be refused? | unconfirmed | engineering |


#### Rules held below established

No live check-decided criterion would fail if a rule below were false. Following the branch method (BR-623), a rule whose behaviour is measured in code, with the file and line recorded in its row, is held at observed; a rule with a written question about intent is held at unconfirmed or undecided. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-756 | observed | established | No question about intent. Measured at adapters/cli/commands/link.ts:164-170 (type check and default), store/sqlite-store.ts:1348-1350 and store/turso-store.ts:2011-2013 (duplicate link); waiting for a check-decided criterion. |
| BR-758 | observed | established | No question about intent. Measured at service/corpus-service.ts:4497-4540 (deleted parent, filing rules, unparented parent) and store/store-shared.ts detectParentCycleViaAncestry (loop); waiting for a check-decided criterion. |
| BR-759 | unconfirmed | established | Q1: should a new parent link replace the old one? |
| BR-760 | undecided | established or rewritten once Q2 is decided | Q2: should a change of parent be part of the document's version history? |
| BR-761 | unconfirmed | established | Q3: should links to self and to deleted documents be refused? |
| BR-762 | observed | established | No question about intent. Measured at service/ai-provider-service.ts:1070-1130 and adapters/cli/commands/link.ts:122-133 (exit 6, no link); waiting for a check-decided criterion. |
| BR-1025 | observed | established | No question about intent. Measured at service/corpus-service.ts:4510-4517 (refused before any write); waiting for a check-decided criterion. |
