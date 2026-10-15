---
id: BASE-101
type: baseline
role: intent
title: "Read calibration statistics"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-067
links:
  - {id: SPEC-033, type: supersedes}
  - {id: SPEC-094, type: supersedes}
---
## Read calibration statistics

> An owner or an agent sees how often human approvals and rejections agreed with the AI judgment, to decide how far the judge can be trusted on its own.

Scope: reading the statistics. The comparison records are written when a person approves or rejects a judged document (review branch).

### Behaviour

**Command.** A reader asks for the statistics, optionally narrowed to one document type or one judging-instruction version.

**Constraint.** Statistics mode must be asked for. Only the newest comparisons are read. Groups are never pooled across instruction versions or judgment kinds.

**Event.** None. Reading changes nothing and records nothing (BR-557). Nothing else reads the statistics either: they inform a person or agent, and no judging, approval or gate decision changes because of them (BR-1005).

### Terms used here

- **Calibration statistics**, **agreement rate**, **Wilson lower bound**: defined in the branch glossary.

### Boundary notes

- A comparison is recorded only when a person approves or rejects a version that has a judgment (review, "Approve a document" and "Reject a document").
- Staleness-probe comparisons appear as their own kind; the probes belong to hygiene.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Number of newest comparisons read | 200 | product (built in) | 2026-10-09 |
| Confidence level of the lower bound | 95% | product (built in) | 2026-10-09 |

### Depends on

- review: the approval and rejection leaves write the comparisons.
- hygiene (not yet written): the staleness kind of comparison.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The 200-record window is shared by all groups, so a busy document type can push a quiet one out entirely. Should the window be per group? | undecided | product |
| Q2 | Nothing uses the statistics to change behaviour, for example to relax review for a well-calibrated type (BR-1005). Is that intended for now? | undecided | product (owner) |
| Q3 | A document type in the filter that does not exist is answered with 'no calibration records', exit 0, although the command describes a refusal with exit 4 (BR-558). Should it be refused? | undecided | product |
| Q4 | The table leaves out the judgment kind, so a review row and a staleness row for the same type and version look identical (BR-559). Should the table show the kind? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-1005 on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-554 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-555 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-556 | unconfirmed | established | Q1: should the window be per group, so a busy type cannot hide a quiet one? |
| BR-557 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-558 | unconfirmed | decided by Q3 | Suspected defect. If Q3 is answered 'refuse', this rule is rewritten and the code fixed; it is not promoted as written. |
| BR-559 | unconfirmed | decided by Q4 | Suspected defect. If Q4 is answered 'show the kind', this rule is rewritten and the code fixed; it is not promoted as written. |
| BR-1005 | undecided | decided by Q2 | Q2: is it intended that nothing acts on the statistics? |

#### Evidence

| Rule | Code read | Observed in a throwaway corpus |
|---|---|---|
| BR-554 | adapters/cli/commands/calibration.ts:50-53 | exit 2 observed |
| BR-555 | service/judgment-service.ts:340-384 | — |
| BR-556 | service/judgment-service.ts:126, 344-352; store/sqlite-store.ts:2487-2494 | empty corpus: 'No calibration records found.', exit 0 |
| BR-557 | adapters/cli/commands/calibration.ts:55-95 | — |
| BR-558 | adapters/cli/commands/calibration.ts:15, 59 | exit 0 observed |
| BR-559 | adapters/cli/commands/calibration.ts:82-91 | — |
| BR-1005 | callers of the statistics: adapters/cli/commands/calibration.ts:62 and adapters/http/routes.ts:623 only | — |
