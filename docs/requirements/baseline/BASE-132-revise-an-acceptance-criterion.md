---
id: BASE-132
type: baseline
role: intent
title: "Revise an acceptance criterion"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-10
tags: []
parent: BASE-064
---
## Revise an acceptance criterion

> An author revises one acceptance criterion of a spec in place.

### Behaviour

**Command.** An author names a spec and one of its criteria and supplies one or more replacement parts: the statement, the covered requirement items, the cited baseline rules, and, depending on the criterion's mode, the check kind, command and falsifier, or the rubric, or the note.

**Constraint.** The criterion exists; its id and mode never change; every part supplied matches its mode; the result still meets the shape and size limits; a named test file exists or its absence is declared.

**Event.** `AcceptanceCriterionRevised`. If the spec was approved it is also returned to draft (`SpecReturnedToDraft`).

### Terms used here

- **Oracle generation**: a counter on a check-decided criterion that goes up each time its command is rewritten, so that evidence gathered under an older command can be told apart. It is not the document version, which goes up on every edit.

### Boundary notes

- Changing the way a criterion is decided means withdrawing it and declaring a new one; that costs the criterion's existing evidence links.
- Wording is checked when a criterion is declared, not when it is revised. A person-decided criterion can be reworded into an unmeasurable statement and the revision is accepted; approval then refuses it (see Approve a spec).
- Returning an approved spec to draft means the review branch's approval has to happen again.

### Current values

None.

### Depends on

- Declare an acceptance criterion: the shape and size rules and the missing-test check apply to the revised criterion; concurrent edits are arbitrated the same way.
- Declare a falsifier: a revised falsifier must be complete.
- Cite a baseline rule: citations revised here follow the revise rules, not the cite-only rules.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Revising a criterion of an active spec changes the governing contract but leaves the spec active, with no fresh approval. Only approved specs go back to draft. Is a contract change on active work meant to need no re-approval? | undecided | product |
| Q2 | Revising a criterion of an archived or deprecated spec succeeds. Should terminal specs refuse it? (Related to issue 30.) | undecided | product |
| Q3 | Rewording only the statement of an approved spec's criterion returns the spec to draft, the same as rewriting the check. Is a wording-only change meant to cost a full re-approval? | unconfirmed | product |
| Q4 | Wording is not re-checked on revise (see boundary notes). Is that intended, with approval as the backstop, or should revise refuse an unmeasurable statement as declare does? | unconfirmed | product, engineering |



#### Downgraded in pilot v2 — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Was | Open question |
|---|---|---|
| BR-31 | established | Must changing a criterion's verification mode always be done by withdrawing and re-declaring it, even when the new mode's evidence would be compatible? |
| BR-33 | observed | Must a revised statement or command still respect the declaration size limits (2000 / 1000 characters)? |
| BR-34 | established | When covered requirement items are revised, should the new list replace the old one entirely, with an empty list clearing it? |
| BR-36 | observed | Should rewording only the statement of a criterion whose test file is still missing require the reason again? (only command-edit refusal is tested: ac-set.test.ts:382) |
| BR-37 | observed | Is it acceptable that a revision can make a criterion unmeasurable and only approval catches it, or should revising re-check wording? |
| BR-42 | observed | When revising a falsifier, must every part be supplied again together, with a partial revision refused and the stored falsifier unchanged? |
| BR-43 | observed | Must the history entry of a revision state when the spec was returned to draft? (AC-ACS-12 checks status equality, not the entry text) |
| BR-44 | observed | When two sessions revise criteria from the same version, must exactly one land and the other be refused as stale? |
