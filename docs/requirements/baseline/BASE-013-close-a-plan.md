---
id: BASE-013
type: baseline
role: intent
title: "Close a plan"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-12
tags: []
parent: BASE-005
links:
  - {id: SPEC-097, type: supersedes}
---
## Close a plan

> A plan is archived once its verified work meets the plan-close conditions. Closing also archives the plan's handoffs, and those remaining open tasks that meet the requirements for archiving a task.

### Behaviour

**Command.** A person or agent sets a plan's status to archived.

**Constraint.** The plan is approved or active (BR-213). Unless the conditions are switched off (BR-214) or the plan is exempt (BR-222, BR-223): every criterion owned by an evidence-bearing task is attested (BR-217, BR-218, BR-220), every evidence-bearing task declared its criteria (BR-219), and the optional attested share is met (BR-221). User acceptance is required when declared (BR-224). The assessment is fresh when one exists (BR-225). When the project turns on the sync switch, no rule cited by the spec's criteria may be contradicted or stale (BR-984); an edit to a domain document is no longer required (BR-226).

**Event.** `PlanClosed` (with the lists of children archived, skipped with the refusing requirement, and failed, BR-1072; a notice when nothing was measured, BR-227), or `PlanCloseDenied` (outcome code 4, the plan unchanged, BR-228).

### Terms used here

- **Evidence-bearing task**: a member task with at least one evidence row.
- **Owned criteria**: the check-decided criteria that the plan's evidence-bearing tasks declare they own, limited to those the spec declares.
- **Attested share**: rows with a runner record divided by all evidence rows across the plan, whatever their result.
- **Exemption kind**: one of red-first testing, no oracle, pipeline unreachable, or other.
- **Not applicable**: a check that had nothing to measure. It never denies, and it is reported.
- **Unmeasured close**: a close in which every check that ran was not applicable.
- **Rule state**: how a cited rule stands against its criteria's checks. **Contradicted**: the latest attested run of a criterion citing it failed. **Stale**: the code of the citing spec changed after the latest attested pass. **Verified**, **unverified** (no attested run) and **unknown** (staleness could not be determined, for example without git history) do not refuse a close.
- **Sync switch**: the project setting for the plan-close sync check. It used to require a domain-document edit; it now turns on the cited-rule check.

### Boundary notes

- Whether the plan's tasks are finished is not a close condition: a close is never refused because of an open task. Each open member task that is not freshly claimed is archived only if it meets every requirement for archiving a task (attested pass, red-first, new test, whole-file run); otherwise it stays open and is listed as skipped with that requirement, in readable output too (BR-1072, `spec-approval-and-plan-closure-go-through-the-same-checks-on` D5-D7). Handoffs are archived as before, and one child's failure never undoes the closure. The archive-a-task leaf announces the moment the last task finishes (BR-211). The hygiene branch reports a plan whose tasks are all finished but which is still open.
- Writing the user-acceptance verdict and the assessment belongs to other branches. This leaf only reads the latest of each.
- How rule state is computed from evidence and code changes belongs to **specification** (rule verification). This leaf only reads the state of the rules the plan's spec cites.
- Membership of a task in the plan is decided by the task's declared plan, not by where it is filed. Handoffs are found by where they are filed.
- In this repository the sync switch is on, so the cited-rule check runs here. It is off by default.
- The archive sweep applies the same check to a closed plan's leftover tasks (BR-1072, `spec-approval-and-plan-closure-go-through-the-same-checks-on` D8, issue 173 fixed). Applying the sweep leaves a task that fails a requirement open and lists it as skipped, refused by that requirement (the machine-readable result carries the requirement too); the sweep report keeps listing such a task with the requirement that refuses it, so it never goes silent. Handoffs are archived by the sweep as before.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Plan-close conditions as a whole | on (new project and this repository) | project settings maintainer | 2026-10-08 |
| Minimum attested share | none (new project and this repository) | project settings maintainer | 2026-10-08 |
| Sync switch (cited-rule check) | off for a new project; on in this repository | project settings maintainer | 2026-10-10 |
| How long a claim protects a task from being archived by the close | 120 minutes (new project and this repository) | project settings maintainer | 2026-10-08 |

### Depends on

Rules this leaf depends on (recorded on the leaf):

- archive-a-task: BR-211 (last-task notice); BR-199 and the other archival requirements, which the close applies to each task it archives (BR-1072).
- claim-a-task: BR-126 (when a claim is fresh), which decides the tasks BR-1072 skips as freshly claimed.

Leaves this one reads in general, without depending on one of their rules:

- record-evidence: runner records and result kinds.
- create-a-task: declared criteria list.
- plan-the-work: plan membership and plan statuses.
- specification (rule verification): the state of each cited rule (BR-984).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Resolved 2026-10-12 by `spec-approval-and-plan-closure-go-through-the-same-checks-on` D5-D8: a close checks each open task against the requirements for archiving a task and leaves a refused task open, listed as skipped with its requirement; it does not refuse the close (BR-1072; issue 47 fixed). The archive sweep applies the same check (D8, issue 173 fixed). | resolved | product (owner) |
| Q2 | Resolved 2026-10-12 by `spec-approval-and-plan-closure-go-through-the-same-checks-on` D7: the readable close output lists each child archived, skipped (with the refusing requirement, or fresh claim) and failed (BR-1072; issue 47 fixed). BR-216, which said the readable output lists none of them, was retired on 2026-10-12, superseded by BR-1072. | resolved | engineering |
| Q3 | An attested fail counts as coverage, so a plan whose criteria were all last seen failing can close (BR-218). Should it? | undecided | product |
| Q4 | A never-assessed plan bypasses the freshness condition (BR-225). Should a plan need an assessment to close? | undecided | product |
| Q5 | No oracle pins that a draft plan cannot be archived (BR-213). | undecided | engineering |
| Q6 | Live criterion AC-069-3 still speaks of 'the default 0.5 floor'. The default is now none (BR-221), and its test was updated, but the statement was not. Should the criterion's statement be corrected? | unconfirmed | engineering |
| Q7 | No criterion cites BR-250. Which criterion, with a test that fails if the rule is false, should establish it? | unconfirmed | engineering |
| Q8 | BR-226 was rewritten when the domain-document requirement was replaced. Its citing criterion AC-PCI-10 tested the old requirement, so it no longer proves the rule. Which criterion should establish the new statement? | unconfirmed | engineering |
| Q9 | BR-984 is cited by an approved criterion of the baseline slice 3a spec; it stays unconfirmed until that criterion's check has been recorded as passing against this rule. | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-10, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-213 | unconfirmed | established | Q5 |
| BR-214 | unconfirmed | established | Its only citation was removed in the 2026-10-09 citation audit. Cited again since 2026-10-12 by AC-AP-4 (case e) of `spec-approval-and-plan-closure-go-through-the-same-checks-on`; held here until that check is recorded passing against this rule. |
| BR-222 | unconfirmed | established | Same audit removal as BR-214. Which criterion should establish it? |
| BR-226 | unconfirmed | established | Q8 |
| BR-250 | unconfirmed | established | Q7 |
| BR-984 | unconfirmed | established | Q9 |

BR-215 (a close archives open tasks with none of the archival requirements) was retired on 2026-10-12, superseded by BR-1072 (established, cited by AC-AP-4 to AC-AP-10 of `spec-approval-and-plan-closure-go-through-the-same-checks-on`). AC-097-2 of the locked spec `spec-lifecycle-archival-plan-close-cascade-deterministic` still cites it and records the old behaviour.
