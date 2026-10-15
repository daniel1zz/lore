---
id: BASE-123
type: baseline
role: intent
title: "Probe documents for staleness"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
links:
  - {id: SPEC-102, type: supersedes}
---
## Probe documents for staleness

> A maintainer or agent asks an AI whether old knowledge documents and decision records still hold, most-cited and oldest first, and sees which ones are open stale candidates.

Scope: the staleness mode of the review command (batch, single document, and the read-only list). Judging documents for approval is the review branch's; invalidating a stale document is corpus's.

### Behaviour

**Command.** Someone asks for a staleness probe of the most valuable candidates, of one document, or for the list of open stale candidates.

**Constraint.** Only knowledge documents and decision records; not deleted, not invalidated, old enough. AI is required except for the list.

**Event.** `StalenessProbed` (one staleness judgment and one audit entry per probed document; the document itself unchanged).

### Terms used here

- **Staleness probe**, **stale candidate**, **last confirmed**: defined in the branch glossary.

### Boundary notes

- The same command judges documents for approval (review, leaf "Judge a document") and approves existing ledger records (autonomy). Their sites are mapped to those owners.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Candidates per batch | 5 | project maintainer | 2026-10-09 |
| Minimum age | 14 days | project maintainer | 2026-10-09 |
| Characters of the document the AI reads | 12,000 | project maintainer | 2026-10-09 |
| Neighbouring documents shown | 20 | project maintainer | 2026-10-09 |

### Depends on

- review: the judgment store shared with approval judgments (a different kind).
- corpus: invalidating, which the printed repair command performs.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Archived, deprecated and draft documents are probed too. Should only approved or active ones be? | unconfirmed | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-462 | unconfirmed | established | Should finished documents be excluded from probing? |
| BR-468 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-471 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-472 | unconfirmed | established | Should naming a document together with a batch size be refused rather than ignored? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-470. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
