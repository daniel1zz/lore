---
id: BASE-114
type: baseline
role: intent
title: "Reject a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-004
links:
  - {id: SPEC-005, type: supersedes}
  - {id: SPEC-033, type: supersedes}
---
## Reject a document

> A reviewer sends a draft or in-review document back to draft, optionally with a reason on record.

### Behaviour

**Command.** A reviewer rejects a draft or in-review document, optionally giving a reason and a note on how the rejection relates to the judgment.

**Constraint.** Only a draft or in-review document. The result is always draft, with the same text and the same version number.

**Event.** `DocRejected` (an audit entry; there is no history entry).

### Terms used here

- **Reviewer**, **calibration record**: defined in the branch glossary.
- **Rejecting** (a reviewer's act) is unrelated to a **reject verdict** (what a judgment says).

### Boundary notes

- A rejection is a human decision and needs no judgment. A reject verdict does not reject the document; see the judge leaf.
- Today a rejection has no effect on later approval (BR-297). Whether it should is open (Q2).
- An approved document cannot be rejected; there is no way to take it back to draft except a revision of its body or title (corpus).
- A rejection is refused before anything is written when the document cannot be found or the reviewer is named twice differently (BR-316); a deleted document, however, can still be rejected (BR-299, issue 70).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A rejection leaves no version entry, only an audit entry, so the document's history does not show it. Intended? | undecided | product |
| Q2 | Should a rejection stick, so the same version cannot be approved until it is edited or the rejection is withdrawn? | undecided | product (owner) |
| Q3 | Rejecting an in-review document prints that its status "remains" draft (issue 67). | unconfirmed | engineering |
| Q4 | A reason is optional, so an author can be sent back to draft with no reason recorded (BR-295). Should a reason be required? | undecided | product |
| Q5 | A deleted document can still be rejected, while judging it is refused as not found (issue 70). Should rejecting a deleted document be refused as not found too? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-292 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-293 | unconfirmed | established | Should a rejection appear in the document's history (Q1)? |
| BR-294 | unconfirmed | established | Should the confirmation name the move from in review to draft (Q3)? |
| BR-295 | unconfirmed | established | Should a reason be required, so the author learns why (Q4)? |
| BR-296 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-297 | undecided | established once Q2 is decided | Should a rejection hold the document until it is edited (Q2)? |
| BR-298 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-299 | unconfirmed | established | Should a deleted document be refused as not found (Q5, issue 70)? |
| BR-316 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
