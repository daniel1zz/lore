---
id: BASE-035
type: baseline
role: intent
title: "Revise a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-11
tags: []
parent: BASE-066
links:
  - {id: SPEC-002, type: supersedes}
  - {id: SPEC-019, type: supersedes}
  - {id: SPEC-022, type: supersedes}
---
## Revise a document

> An author changes a document's title, body, priority, tags, name or details.

Scope: the generic edit. Status changes made with the same command are review's ("Submit a document for review", BR-307 for the status map) and execution's (plan close); accepting a decision record is its own leaf; a spec's kind and criteria on edit are specification's (BR-246, BR-247).

### Behaviour

**Command.** An author edits one or more fields of a document. Given no field, the command line opens the body in the author's text editor and writes nothing if it comes back unchanged (BR-724). The body can also be rewritten by AI, from the type's template or with a prompt; that needs AI to be on for the calling surface (exit code 2 otherwise) and an AI failure ends with exit code 6, with nothing written (BR-733).

**Constraint.** The edit must be well-formed (BR-727), and a decision or knowledge record's details must stay valid for its type (BR-729); a rename must be free (BR-725); details owned by dedicated actions cannot be dropped or changed (BR-728, BR-730). If another write landed since the edit read the document, the edit is refused as out of date with exit code 5 (BR-732). A body or title change, including an AI rewrite, takes an approved document back to draft (BR-722), unless it is a locked record, where it is refused ("Keep a record unchanged", BR-1048). An empty title is accepted (BR-726), and so is an edit of a deleted document named directly (BR-731); both are suspected defects (Q3, Q4).

**Event.** `DocRevised`: exit code 0, the version raised by one, a version entry and an audit entry naming the actor (BR-721), even when nothing changed (BR-723).

### Boundary notes

- Whether an edit is allowed at all depends on whether the document is living or a locked record: a body or title change to a locked record is refused, except as a recorded correction ("Keep a record unchanged", BR-1048, BR-1049). The demotion to draft below applies to living documents and to records not yet locked.
- The revision rule for approved documents is written here. Its one wrong case, a rewrite with identical text that still demotes, is held in review as BR-312 and is meant to move here; it is not repeated.
- Automatically approved ledger records are put back to approved in the same write; that is autonomy's.
- A status value outside the six statuses is refused; that rule is review's BR-319.
- The foreign-corpus refusal applies here (BR-802).

### Depends on

- Read a document: resolving the reference.
- Submit a document for review: the status map.
- Keep writes in this checkout's corpus: the foreign-corpus refusal applies to every edit (BR-802).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | An edit that changes nothing still writes a version (BR-723). Should it be a no-op, as the rename option's help says? | unconfirmed | engineering |
| Q2 | Details left out of an edit are dropped silently unless they are one of the three fields guarded by BR-728 (plan phases, task claim, task evidence); the invalidation part of details is guarded separately (BR-730). Should an edit merge details instead of replacing them? | undecided | product |
| Q3 | Should a deleted document refuse edits (BR-731)? | unconfirmed | product |
| Q4 | Suspected defect: an empty title is accepted on edit although creation refuses it (BR-726). Should an edit refuse it too? | unconfirmed | product |


#### Rules held below established

No live check-decided criterion would fail if a rule below were false. Following the branch method (BR-623), a rule whose behaviour is measured in code, with the file and line recorded in its row, is held at observed; a rule with a written question about intent is held at unconfirmed or undecided. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-723 | unconfirmed | established | Q1: should an edit that changes no field write nothing? |
| BR-724 | observed | established | No question about intent. Measured at adapters/cli/commands/set.ts:593-610 (editor opened; unchanged text prints 'no changes'); waiting for a check-decided criterion. |
| BR-726 | unconfirmed | established | Q4: should an empty title be refused on edit as it is on creation? |
| BR-727 | observed | established | No question about intent. Measured at service/corpus-service.ts:2081-2090 (patch shape, including priority) and :2195-2210 (name format); waiting for a check-decided criterion. |
| BR-728 | undecided | established once Q2 is decided | Q2: should an edit merge details rather than replace them? |
| BR-729 | observed | established | No question about intent. Measured at service/corpus-service.ts:2405-2420 (decision or knowledge details re-checked for the type); waiting for a check-decided criterion. |
| BR-731 | unconfirmed | established | Q3: should an edit of a deleted document be refused as not found? |
| BR-732 | observed | established | No question about intent. Measured at store/sqlite-store.ts:768-845 (out-of-date write refused, exit 5); waiting for a check-decided criterion. |
| BR-733 | observed | established | No question about intent. Measured at adapters/cli/commands/set.ts:315-405 (AI off ends with 2, AI failure with 6); waiting for a check-decided criterion. |
