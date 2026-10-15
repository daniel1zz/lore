---
id: BASE-115
type: baseline
role: intent
title: "Run verification"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-10
tags: []
parent: BASE-005
---
## Run verification

> The trusted runner executes a plan's check-decided criteria for one task and records each result with a runner record.

### Behaviour

**Command.** A person or agent asks the runner to verify a plan (or, for an ad hoc task, the task alone), optionally naming the task and the criteria to run, approving new commands in advance, or naming where to run.

**Constraint.** One target task; only criteria the task declares it owns (or the caller names); only criteria decided by a check; new commands approved; a launch or write failure stops the whole run.

**Event.** `VerificationRecorded` (one per executed criterion), or `VerificationAborted`.

### Terms used here

- **Target task**: the single task a run records against. It is the task the caller names, or else the plan's only task with a fresh claim.
- **Declared criteria**: the list of criteria a task says it owns. A task can have never declared any, or can have declared an empty list. These are two different states.
- **Runner record**: the block on an evidence row that holds the observed outcome code, elapsed time and timeout flag, written by the product after it ran a command itself. A row carrying one is called *attested*.
- **First seen**: a mark on a result whose command had never appeared in the target task's evidence before.
- **Inconclusive**: a result that is neither pass nor fail because the run cannot show what it claims. Examples: fewer test files ran than were named, no test was found, or the built product was out of date.
- **Place of execution**: where a check's command started. This is either the project root or a separate working copy of the project.

### Boundary notes

- Recording evidence by hand, or capturing a command the caller chose, belongs to the record-evidence leaf. Only this leaf derives the command from the declared criteria.
- Proving that a criterion can fail is the prove-a-red leaf. It shares the target-task resolution but not the scope selection or the command approval.
- The runner never moves any status (BR-184). Archival is the archive-a-task leaf.
- In machine-readable output an interactive approval prompt is never shown. A non-interactive caller must approve in advance or be refused.
- A one-time warning about the trust boundary is printed before checks run. It does not affect the outcome.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Default time limit per check | 15 minutes (new project and this repository) | project settings maintainer | 2026-10-08 |
| Grace period between the stop request and the forced stop | 5 seconds (fixed in the product) | engineering | 2026-10-08 |
| Approval of new commands | on (new project and this repository) | project settings maintainer | 2026-10-08 |
| Environment passed to checks | built-in allowed set only; pass-everything off (new project and this repository) | project settings maintainer | 2026-10-08 |
| How long a claim stays fresh | 120 minutes (new project and this repository) | project settings maintainer | 2026-10-08 |

### Depends on

- claim-a-task: freshness of a claim decides the target task (BR-162).
- create-a-task: a task's declared criteria list (BR-163 to BR-166).
- record-evidence: how a recorded row is stored, its criterion currency stamp, and refusal of caller-supplied runner records.
- BR-20 (a check-decided criterion names its kind and exact command), BR-23 (a criterion id is unique only within its spec), BR-40 (a changed command moves the criterion to a new generation).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | No live criterion selects the tests pinning the named-criteria escape, the empty-list refusal when criteria are named, or the zero-match refusal (BR-166). | undecided | engineering |
| Q2 | Outcome code 3 for inconclusive results, and its precedence over 1, are stated by a live criterion whose oracle never observes an outcome code (BR-178). | unconfirmed | engineering |
| Q3 | The revision and uncommitted-changes stamp on runner records has tests but no criterion runs them (BR-181). | undecided | engineering |
| Q4 | The command-level help lists outcome code 3 only for the file-count check. In the code, a no-test-found result and an out-of-date built product also give inconclusive and therefore outcome 3. | unconfirmed | engineering |
| Q5 | Nothing pins the invariant that verification never moves a status (BR-184). | undecided | product |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-168, BR-171, BR-172, BR-175, BR-177, BR-180, BR-182, BR-183. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
