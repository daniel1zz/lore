---
id: BASE-049
type: baseline
role: intent
title: "Supersede a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
---
## Supersede a document

> An author replaces a knowledge record or decision record by a new one, in one request.

Scope: the combined request (create, then invalidate). Creating the new document follows "Create a document"; invalidating the old one follows "Invalidate a document".

### Behaviour

**Command.** An author creates a document and names the document it supersedes.

**Constraint.** The old document must be a knowledge record or a decision record, checked before anything is written (BR-710).

**Event.** `DocCreated` then `DocInvalidated` (the old document's successor is the new one).

### Boundary notes

- Plans, tasks, specs and requirements documents cannot be superseded this way; the refusal names the two-step route (create, then invalidate with a successor).
- When the second half fails the first half stays (BR-712); there is no rollback.

### Depends on

- Create a document, Invalidate a document.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A task can be invalidated with a successor but not superseded in one request. Is the type list meant to differ from the invalidation's? | undecided | product |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-710. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
