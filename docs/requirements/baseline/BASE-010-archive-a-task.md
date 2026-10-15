---
id: BASE-010
type: baseline
role: intent
title: "Archive a task"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-12
tags: []
parent: BASE-005
---
## Archive a task

> A task is moved to archived only after its evidence shows the work was verified.

### Behaviour

**Command.** A person or agent archives one task. They may give a reason to waive the attested-pass requirement, cite an existing evidence row instead of a reason, or state that the task adds no new test. The worktree sweep is not part of this leaf: it now covers every linked worktree and is held on "Remove a seat" (BR-1079; BR-962, retired, described the earlier sweep over archived tasks' claim worktrees only).

**Constraint.** At least one attested pass; a red row if the task declared red-first; a red row or a no-new-test declaration if the task declared its criteria; a whole-file pass for every reserved test file; no fresh claim by another actor. They are checked in that order and only the first unmet one is reported (BR-209). After a successful walk, the worktree recorded on the task's claim is removed when the removal guard on "Remove a seat" allows it, with no elapsed-time condition (BR-1079, BR-1070); otherwise it is kept and the reason reported. BR-961 and its 30-minute quiet period are retired.

**Event.** `TaskArchived` (one recorded change per lifecycle step), or nothing for an already finished task. The same output reports whether the claim's worktree and branch were removed or kept, with the reason when kept (BR-1079), and, when this was the plan's last open task, that the plan has no open tasks left and how to close it (BR-211).

### Terms used here

- **Attested pass**: a pass row carrying a runner record. It comes either from a verification run or from capturing a command the product ran itself.
- **Red row**: a fail or expected-fail row, with or without a runner record.
- **Red-first declaration**: a mark set on the task by its own red-first command, stating that a red row must exist before archival (BR-205).
- **Waiver**: a written reason, or a cited pass row, that lifts the attested-pass requirement only. It is stored on every step of the walk.
- **No-new-test declaration**: a written reason saying the task legitimately adds no test.
- **Reserved test file**: a file anchor of the task that names a single test file. A folder anchor reserves no test file.
- **Whole-file run**: a test command that runs a reserved test file without narrowing it to particular test cases.
- **Claim worktree**: the working copy a claim on the task recorded. Archival removes only this worktree; the sweep on "Remove a seat" covers every linked worktree (BR-1079).

### Boundary notes

- Capturing and reporting evidence belong to the record-evidence leaf. This leaf only reads the rows.
- Archival of a phase uses the same command but is handed to the phase workflow. Its rules are not described here.
- A plan close archives an open member task only when it meets these requirements (the branch overview, Execution, states the same, BR-1072); a task that fails one stays open and is listed as skipped with that requirement (BR-1072, `spec-approval-and-plan-closure-go-through-the-same-checks-on` D5, D6). The close and this leaf use one copy of the checks. A direct status change still archives a task with no checks (BR-212, issue 174). BR-215, which said the close applied none of them, was retired on 2026-10-12, superseded by BR-1072.
- The refusal for the attested-pass requirement counts self-reported and runner-labelled pass rows separately. It explains that a runner label is not a runner record.
- The worktree sweep earlier covered only claim worktrees of archived or deprecated tasks (BR-962, retired). It now covers every linked worktree and is held on "Remove a seat" with the removal guard (BR-1079, BR-1070). This leaf keeps only the removal of the archived task's own claim worktree. General health, drift and stale-claim sweeps stay with hygiene.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| How long another actor's claim blocks archival | 120 minutes after the claim (new project and this repository) | project settings maintainer | 2026-10-08 |

### Depends on

- record-evidence: the result kinds and the attestation a captured run carries (BR-146, BR-151).
- claim-a-task: when a claim is fresh or stale (BR-126).
- create-a-task: the declared criteria list and its two empty states (BR-119), and the file anchors that reserve test files (BR-122).
- close-a-plan: BR-1072 archives a member task only when it meets these requirements (BR-215, retired 2026-10-12, superseded by BR-1072).
- run-verification: BR-179 produces attested rows.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Should one attested pass of any command satisfy archival, whatever criteria the task owns and even if their checks changed since (BR-200)? | undecided | product |
| Q2 | A captured pass of a caller-chosen command clears the same requirement as a verification-run pass (BR-201). Is that intended? | undecided | product |
| Q3 | Probable defect: the refusal calls the verification runner the sole issuer of runner records (BR-202). | unconfirmed | engineering |
| Q4 | The cited waiver, the no-new-test declaration and resumption after interruption have no live oracle (BR-204, BR-206, BR-210). Which criteria should establish them? | undecided | engineering |
| Q5 | The whole-file refusal says 'attested' while a self-reported pass is accepted (BR-207). | unconfirmed | product, engineering |
| Q6 | Probable gap: a direct status change archives a task with no checks (BR-212). | unconfirmed | product |
| Q7 | Closed 2026-10-12: worktree removal on archive and the sweep are stated by BR-1079 on "Remove a seat" (established, cited by AC-WS-1, AC-WS-2, AC-WS-3, AC-WS-5 and AC-WS-6), which consults no elapsed time; BR-961 and BR-962 are retired. | closed | engineering |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-199, BR-201, BR-203, BR-205, BR-207, BR-209. Each of these six lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question for each (owner: engineering): which criterion, with a test that fails if the rule is false, should establish it?
