---
id: BASE-009
type: baseline
role: intent
title: "Submit a document for review"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-004
links:
  - {id: SPEC-005, type: supersedes}
---
## Submit a document for review

> An author puts a draft in review, or moves a document among the review statuses, by changing its status.

Scope: the moves among draft, in review and approved done by a plain status change, and what no request can do. The generic edit of a document (title, body, priority, tags, slug, extra details) is corpus behaviour and is not described here. The whole status map is stated here (BR-307) because one request makes every status change and one refusal answers every move off the map; the moves after approval are owned by execution and corpus. Two rules outside the review moves are held here for now, each tied to a suspected defect, until their owners take them: BR-312 (issue 66, corpus) and BR-313 (issue 69, execution and corpus).

### Behaviour

**Command.** An author sets a document's status: to in review, back to draft, or straight to approved.

**Constraint.** Only moves on the status map are accepted; any other is refused with the allowed moves. The map has one type exception: a task or a knowledge document may go from draft straight to archived (BR-313). Moving to approved this way is an approval: it passes or fails exactly as the approval leaf would on the same document (judgment, spec and plan conditions, citation check, same exit code and refusal), and a call that also changes another field is refused with exit code 4 and writes nothing (BR-1071, `spec-approval-and-plan-closure-go-through-the-same-checks-on` D1, D4). A spec moved to approved this way must still have a criterion citing a live business or architecture standard rule (BR-1026, the status-change road of BR-1007). A status that is not one of the six is refused (BR-319).

**Event.** `DocStatusChanged` (a version entry and an audit entry of an ordinary update). A move into approved is recorded as an approval instead (`DocApproved`, BR-1071).

### Terms used here

- **Document status**, **review queue**: defined in the branch glossary.

### Boundary notes

- Approved to draft stays refused as a status move (BR-307). The only way an approved specification returns to draft is reopening it, which is its own action with its own conditions ("Keep a record unchanged", BR-1050, BR-1054).
- Approval proper is the approval leaf. This leaf is the second road into approved, which runs the approval leaf's checks and records an approval (BR-1071), and the only road into in review.
- The spec conditions apply on this road too (specification, BR-77), and since 2026-10-12 so do the plan conditions (BR-1071, issue 50 fixed). BR-108 on "Plan the work" (execution), which said this road skips them, was retired on 2026-10-12, superseded by BR-1071. BR-307 states that a move into approved is recorded as an approval (narrowed 2026-10-12).
- A revision of an approved document's body or title takes it back to draft unless it is a locked record, which is refused ("Keep a record unchanged", BR-1048); that rule is corpus's (and the spec leaf's BR-81 for specs). The one wrong case is held here as BR-312.
- Moving a document on after approval (active, archived, deprecated) and archiving a task belong to execution and corpus. BR-307 names those moves only so the refusal is complete; BR-313 is held here only while issue 69 is open.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | In review has no entrance rule, no exit rule, and no list (issue 68). Is in review meant to stay a status? | undecided | product (owner) |
| Q2 | Resolved 2026-10-12 by `spec-approval-and-plan-closure-go-through-the-same-checks-on` D1: the direct road stays, and setting a spec or decision record straight to approved now needs the same judgment as approval (BR-1071; issue 65 fixed). | resolved | product, engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-307 | unconfirmed | established | Is the status map meant to be exactly this, with no way back from approved and a draft-to-archived exception only for tasks and knowledge? |
| BR-308 | unconfirmed | established | Should submitting request a judgment or notify a reviewer? |
| BR-309 | unconfirmed | established | Is an author withdrawing the same thing as a reviewer rejecting, given only one of them leaves an audit entry naming a reason? |
| BR-310 | unconfirmed | established | Answered for specifications: an approved spec without evidence returns to draft by reopening it (BR-1050, BR-1054), and a locked record's body or title revision is refused (BR-1048). BR-310's statement does not yet name these exceptions. For other types: should a deliberate way back exist? |
| BR-312 | unconfirmed | established | Should an edit that changes nothing leave the approval alone? On a locked record the rewrite is refused instead (BR-1048), an exception BR-312's statement does not yet name. |
| BR-313 | unconfirmed | established | Is the type exception meant, with the comments to be corrected, or the other way round (issue 69)? |
| BR-319 | unconfirmed | established | No question about intent: refusing an unknown status is meant. It is held until a check-decided criterion would fail if the refusal stopped. |
| BR-1026 | unconfirmed | established | No question about intent: the citation condition is meant (BR-1007). Cited since 2026-10-12 by AC-AP-1 (case h) of `spec-approval-and-plan-closure-go-through-the-same-checks-on`; held here until that check is recorded passing against this rule. |

BR-311 (the direct road skips the judgment) was retired on 2026-10-12, superseded by BR-1071 on "Approve a document".
