---
id: BASE-122
type: baseline
role: intent
title: "Report corpus health"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-065
---
## Report corpus health

> An agent, reviewer or pre-push hook gets one result for every health check asked for, sees the corpus counts, and can list the members behind each count.

Scope: how the status command combines its checks into one exit code; the plain report; the open-defect-report check; the baseline integrity check; and listing the members behind a count. The individual checks are the other status leaves.

### Behaviour

**Command.** Someone runs the status command with any set of checks, none, or a request to list the members behind a count.

**Constraint.** Checks that read the corpus run together and their results are combined; three stand-alone checks win over the rest. The plain report never fails.

**Event.** `HealthReported` (nothing recorded).

### Terms used here

- **Health check**, **finding**, **advisory note**: defined in the branch glossary.

### Boundary notes

- Defect reports themselves (filing, resolving, closing) are issue-loop's; this leaf only reports the ones left open.
- Baseline nodes and rules are product-baseline's; this leaf only reports integrity findings.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Days after which an open defect report is stale | 14 | project maintainer | 2026-10-09 |

### Depends on

- Every other status leaf of this branch.
- issue-loop (not yet written): defect reports and their computed resolution.
- product-baseline (not yet written): the baseline tree and its rule registry.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A fixed defect report whose task is deprecated, not archived, is flagged forever. Intended? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-439 | unconfirmed | established | Should a combination that silently drops requested checks be refused instead? |
| BR-440 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-443 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-444 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-446 | undecided | established | Should a deprecated report task count as closed? |
| BR-447 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
