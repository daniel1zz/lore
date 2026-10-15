---
id: BASE-098
type: baseline
role: intent
title: "List defect reports"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-002
links:
  - {id: SPEC-099, type: supersedes}
---
## List defect reports

> Anyone working on lore, or on a project that reports to it, sees every defect report with its computed resolution, and which corpus or repository the list came from; on the dashboard, a signed-in person sees the incoming reports still waiting for a decision.

Scope: the listing modes of the list command, the listing switch of the filing command, and the dashboard's issues page as a listing. The label check (`--verify`) is the leaf "Check resolution labels". Deciding a report (approve, or reject with a reason) is review's, even when the control sits on the issues page.

### Behaviour

**Command.** A reader lists defect reports, optionally only unfinished ones (the default), only finished ones, or all, optionally narrowed by severity or category, optionally from this corpus only. On the dashboard, a signed-in person opens the issues page or one report from it.

**Constraint.** With a GitHub destination the list is read live from GitHub and joined with this corpus's tasks; otherwise, or when asked, it is read from this corpus (BR-505, BR-506, BR-507). The retired form is refused. Each report's resolution is computed from the corpus (BR-510, BR-511, BR-512). Listing writes nothing (BR-513), on the dashboard too (BR-990).

**Event.** None (a query). `DefectReportsListed` is not recorded anywhere. An approval or rejection made from the issues page is review's event; afterwards the report leaves the page's list (BR-990).

### Terms used here

- **Ingested**, **resolution**, **explicit resolution**, **resolving link**, **finished report**, **severity**, **category**: defined in the branch glossary.
- **Incoming defect report**: a report filed into this corpus by a project that reports to it, held as a task waiting for a decision.

### Boundary notes

- The resolving link itself is created by the corpus link command; only its effect on a report's resolution is ruled here (BR-510).
- Explicit resolutions are recorded by the resolve leaf (BR-532); the precedence that decides between them and links is here.
- Archiving a report's task belongs to execution; an archived report with nothing else recorded reads closed (BR-510).
- Approving or rejecting a report's task is review's ("Approve a document", "Reject a document"). This leaf only says the issues page offers the decision and that a decided report leaves its list.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Issues read from GitHub per listing | 100 (one page, no further pages) | lore maintainers | 2026-10-09 |
| Default mode | unfinished reports only | lore maintainers | 2026-10-09 |

### Depends on

- File a defect report / Adopt a GitHub issue: the tasks the list joins with.
- Resolve a defect report: the explicit resolutions.
- corpus (not yet written): resolving links and document status.
- review: the decision offered on the issues page.
- distribution, "Launch the dashboard": the signed-in dashboard.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Only the first 100 GitHub issues are read, pull requests included. Should the list page through all issues and leave pull requests out? | unconfirmed | engineering |
| Q2 | The filing command's listing switch shows all reports and refuses when nothing is configured, while the list command shows unfinished ones and falls back to this corpus. Is the difference meant? | undecided | product |
| Q3 | A report rejected in review still reads open in the list command, while the dashboard's issues page leaves it out. Should a review rejection count, and should the two listings agree? | undecided | product |
| Q4 | Two criteria of the governing spec (AC-DC-5, AC-DC-6) and one of the closure-loop spec (AC-ICL-7) name test files that no longer exist. Re-point or retire them? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-990 read on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). Every rule of this leaf held below established is listed here or in the note under the table.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-506 | unconfirmed | undecided | Q2 |
| BR-514 | unconfirmed | undecided | Q1 |
| BR-515 | unconfirmed | undecided | Q3 |
| BR-990 | unconfirmed | established | No question about intent: the issues page is tested under AC-074-2 and AC-074-3, but no criterion cites this rule. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-509. Its only citation was lost when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
