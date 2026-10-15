---
id: BASE-097
type: baseline
role: intent
title: "List documents awaiting review"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-004
links:
  - {id: SPEC-005, type: supersedes}
  - {id: SPEC-033, type: supersedes}
  - {id: SPEC-034, type: supersedes}
---
## List documents awaiting review

> Anyone sees which documents wait for review, with the latest judgment of each; on the dashboard, a signed-in person works through the same queue with the keyboard.

Scope: the pending list command and the dashboard's review queue as a list: what is listed, how each row reads, and how a person moves through it. What approving or rejecting a document does is review's ("Approve a document", "Reject a document"), even when the queue's keys start it.

### Behaviour

**Command.** Anyone asks for the list of documents awaiting review, optionally narrowed by author, type, date, or to those whose latest judgment is an escalation; optionally asking to see everything. The type and the date are not checked: an unknown type gives an empty list, and an unreadable date may give an empty, full or partial list, all with exit 0 (BR-318). On the dashboard, a signed-in person opens the review queue and moves through it with the mouse or the keyboard (BR-992).

**Constraint.** Only documents in draft are listed by the command (BR-300). Tasks, ledger records and invalid documents are left out unless asked for (BR-301, BR-302). Each row names the document and its latest judgment (BR-303, BR-304, BR-305). Filters combine (BR-306). On the dashboard, no queue key acts while the cursor is in a text field or a decision panel is open (BR-992).

**Event.** None: a read-only query. Moving through the dashboard queue records nothing; an approval or rejection started from it is review's event.

### Terms used here

- **Review queue**, **escalation**, **blocking question**: defined in the branch glossary.

### Boundary notes

- Batch judging works through this same list (judge leaf).
- A document in review is in no list of the command (BR-300); the dashboard queue differs here (Q1).
- Ledger records are approved automatically (autonomy); that is why they are hidden here.
- A mistyped filter is not told apart from a genuinely empty queue (BR-318, issue 81). This suspected defect is held here because the filters belong to this list.
- The keyboard keys that approve (a) or open the decision panel (x) only start a decision. The decision's gates, records and evidence view (BR-991) are review's.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A document in review is invisible to the list command and to batch judging, even when everything is asked for (issue 68), while the dashboard's review queue shows in-review documents ahead of drafts. Should the command show them too, so the two queues agree? | unconfirmed | product, engineering |
| Q2 | The code comments in the pending-list command and in the review service say invalid documents are hidden by default because a draft can never be archived and so would wait forever. That reason is not true for every type: a task or a knowledge draft can be archived directly (issue 69). Should the comments be corrected, or the reason for hiding invalid documents restated? | unconfirmed | engineering |
| Q3 | An unknown type or an unreadable date is accepted and gives an empty or wrong list with exit 0 (issue 81). Should such a filter be refused as a usage error? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-318 re-read and reproduced on 2026-10-10; BR-992 read against the dashboard code on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). Every rule of this leaf held below established is listed here.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-300 | unconfirmed | established | Q1 |
| BR-302 | unconfirmed | established | Should an invalid draft ever stay in the list? (Q2 records the stale reason given in the code.) |
| BR-304 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-305 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-306 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-318 | unconfirmed | established | Q3 |
| BR-992 | unconfirmed | established | No question about intent: the keyboard loop is tested under AC-075-5 and AC-075-6, but no criterion cites this rule. |
