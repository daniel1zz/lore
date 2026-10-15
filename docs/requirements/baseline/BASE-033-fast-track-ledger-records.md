---
id: BASE-033
type: baseline
role: intent
title: "Fast-track ledger records"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-11
tags: []
parent: BASE-067
links:
  - {id: SPEC-094, type: supersedes}
---
## Fast-track ledger records

> Records of things that happened (assessments, retrospectives, handoffs, acceptance verdicts) are approved as they are written, so they never wait for a reviewer and never crowd the review queue.

Scope: the fast-track at creation and at edit, its setting, and the backfill sweep (a mode of the review command). Judging documents with the same command belongs to review; hiding ledger records from the review queue is review's list leaf.

### Behaviour

**Command.** Anyone creates or edits a ledger record (through assess, acceptance recording, handoff, or the generic create and edit); an owner runs the backfill sweep.

**Constraint.** Only the four ledger kinds of knowledge record. A project setting can switch creation-time and edit-time fast-track off; the sweep ignores it.

**Event.** `LedgerRecordFastTracked` (an audit entry marked as a fast-track on the create or update it belongs to; marked as backfill for the sweep).

### Terms used here

- **Ledger record**, **fast-track**, **backfill sweep**: defined in the branch glossary.

### Boundary notes

- Retro, assessment, handoff and acceptance (uat) records lock once approved ("Keep a record unchanged", BR-1047): an edit to an approved one is refused, and a correction keeps it approved in a single version without the second approval write described here (BR-1049). The put-back-to-approved behaviour here applies only while the refusal is turned off (BR-1053).
- The generic create and edit are corpus behaviour; this leaf owns only the status they end with for ledger records. The corpus branch should map its fast-track sites to these rules.
- The review queue leaves ledger records out by default (review, "List documents awaiting review").
- This leaf names the `review` command, so its site map also lists that command's judging-mode sites. Each of those entries is marked as owned by a rule of the judge leaf (review, "Judge a document"); this leaf states no rule about judging.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Fast-track at creation and edit | on (new project and this repository) | project settings maintainer | 2026-10-09 |
| Ledger kinds | assessment, retrospective, handoff, acceptance verdict | product (built in) | 2026-10-09 |

### Depends on

- corpus: the create and edit writes.
- Judge a document (review): the rest of the review command.
- Assess a plan's outcome, Record an acceptance verdict, and session's handoff: the writers of ledger records.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | An edit of an approved ledger record is two separate writes, so a failure between them leaves it in draft (BR-604). Should the reset and the re-approval be made one write, as the module notes and the criterion's wording claim? | unconfirmed | engineering |
| Q2 | Rewriting an approved ledger record with identical text still adds two versions and two audit entries (BR-605, same family as issue 66). Should an identical rewrite change nothing? | unconfirmed | engineering |
| Q3 | The sweep exits 0 even when some records failed to write (BR-610). Should a partly failed sweep end with a non-zero exit? | undecided | product |
| Q4 | The sweep approves an invalidated ledger draft and leaves a ledger record in review untouched (BR-611). Should invalidated drafts be left alone, and records in review be included? | unconfirmed | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-604 | unconfirmed | established if the two writes are kept; rewritten if they are made one | Q1. |
| BR-605 | unconfirmed | rewritten if an identical rewrite is made to change nothing; established if the current behaviour is kept | Q2. |
| BR-607 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-608 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-610 | undecided | established if exit 0 is kept; rewritten if a non-zero exit is chosen | Q3. |
| BR-611 | unconfirmed | established if the current scope is kept; rewritten if it changes | Q4. |

#### Evidence

| Rule | Code read | Observed in a throwaway corpus |
|---|---|---|
| BR-602 | service/corpus-service.ts:1472-1475, 1652, 1725; core/src/types.ts:258 | retro approved v1, research draft v1 observed |
| BR-603 | service/corpus-service.ts:2918-2950 | v1 to v3 approved observed |
| BR-604 | service/corpus-service.ts:2900-2917; service/CLAUDE.md:14 (says 'atomically in one write') | — |
| BR-605 | service/corpus-service.ts:2880-2950 | v3 to v5 observed |
| BR-606 | core/src/config.ts:673; service/corpus-service.ts:1472-1475 | draft observed with the setting off |
| BR-607 | service/corpus-service.ts:2918 | draft observed after an edit with the setting off |
| BR-608 | service/corpus-service.ts:1465-1475; core/src/types.ts:258 | — |
| BR-609 | service/review-service.ts:584-636; adapters/cli/commands/review.ts:282-306 | both approved with the setting off; second run reports none |
| BR-610 | service/review-service.ts:628-632; adapters/cli/commands/review.ts:302-304 | — |
| BR-611 | service/review-service.ts:588-593 | — |
