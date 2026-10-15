---
id: BASE-012
type: baseline
role: intent
title: "Record evidence"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-12
tags: []
parent: BASE-005
links:
  - {id: SPEC-025, type: supersedes}
---
## Record evidence

> An agent records the outcome of a check run against a task, as evidence the work does what its criteria say.

### Behaviour

**Command.** An agent records one evidence row on a task: the kind of check, the exact command, the result, and either the captured output (the product runs the command) or typed output, optionally referencing one acceptance criterion.

**Constraint.** Known check kind; result pass, failure or expected failure (inconclusive only from a verification run); no recorder-supplied attestation, version-control facts or criterion revision (the product stamps the revision itself, BR-238); a command shorter than three characters is a placeholder unless it is on the short list of genuine commands (BR-161); failures carry real output; a pass must be captured unless the check is manual; a test pass may not name a test file that cannot be found (BR-253) or files of two different test runners (BR-252); filtered passes must prove a case ran; piped self-reports are refused; a captured "no tests found" is never a red; a captured test or end-to-end failure or expected failure needs a runner summary reporting at least one failed test in the kept output, and a captured run ending 126 or 127 is never a failure or expected failure for any check (BR-1077, BR-152); a capture that cannot start, or is stopped from outside before it reports an exit code, records nothing (BR-254); a referenced criterion must be declared on the task's spec; at most 50 rows; a pass needs the claimed working copy committed.

**Event.** `EvidenceRecorded`.

### Terms used here

- **Evidence row**: one recorded check outcome on a task. Rows are only appended.
- **Self-reported row**: a row whose output the recorder supplied.
- **Runner-captured row**: a row whose command the product ran itself; always carries an attestation.
- **Runner-unattested row**: a row the product's own falsifier run wrote without a runner record (an inconclusive control or changed-check row). It is counted under its own label, never as runner-captured or attested (BR-1073, prove-a-red).
- **Attestation**: what a run measured about itself: exit code, duration, timed out. Never supplied by a recorder.
- **Output tail**: the last 4000 characters of the output kept with a row.
- **Criterion reference**: the one acceptance criterion a row says it proves.
- **Expected failure**: a red run recorded on purpose before the fix; never counts as passing.

### Boundary notes

- Verification runs (the product running every in-scope criterion and writing attested rows) are the run-verification leaf; this leaf owns rows recorded on request.
- Recording a deliberate red and the red-first declaration are the prove-a-red leaf.
- Whether rows are enough to archive the task is the archive-a-task leaf (a pass needs an attestation there).
- Evidence can also be recorded on a phase document through the same command; phase-level rules are outside these leaves.
- Order of the test-pass checks: the missing-file check (BR-253) and the two-runner check (BR-252) run before the must-be-captured check (BR-150). A typed-in test pass naming files of two runners is therefore refused with the two-runner reason; it would be refused by BR-150 otherwise. This is why BR-252 says it applies whether the pass is typed in or captured.
- A capture whose output carries an attestation clears archival's attested-pass floor, but proves only that the given command exited zero, not that it was the criterion's command (see BR-151 and run-verification).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Capture window (longest a captured command may run) | 20 minutes (new project and this repository; a source comment of the evidence command still says 10 minutes, see Q5) | project settings maintainer | 2026-10-10 |
| Most evidence rows per task | 50 (fixed) | engineering | 2026-10-08 |
| Output kept per row | last 4000 characters (fixed) | engineering | 2026-10-08 |

### Depends on

- Create a task (BR-119, BR-120): the scope, and the freeze on evidenced ids.
- Claim a task (BR-141, BR-136): holder renewal and the recorded working copy.
- Declare an acceptance criterion (specification, BR-20): the criteria a row can reference; ids unique only within one spec (BR-23).
- Revise an acceptance criterion (specification, BR-40, BR-41): rows are stamped with the criterion's check generation and never edited by a revision.
- Run verification, Prove a red, Archive a task (execution, other leaves).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Anyone can record evidence on any task, including archived tasks and tasks claimed by someone else (BR-160). Intended? | unconfirmed | product |
| Q2 | A criterion reference need not be in the task's scope and follows the filing plan (BR-157). Should it be limited to the scope and the declared plan? | undecided | product |
| Q3 | A captured row's attestation proves the stated command exited zero, not that the command is the criterion's own. Should a capture referencing a criterion be required to run that criterion's command? | undecided | product (owner) |
| Q4 | The commit-before-attest guard (BR-159) and the task-level inconclusive refusal (BR-147) have tests that no live criterion runs. Should criteria be added? (The capture exit-code check, BR-152, is cited since 2026-10-12 by AC-EH-8 of `spec-evidence-labels-and-reds-are-honest`.) | undecided | engineering |
| Q5 | The evidence command's source comment says the capture window defaults to 10 minutes, while the product applies 20 (filed as issue #110). The value in Current values is the applied one; the comment is to be corrected. | defect | engineering |

#### Held at unconfirmed — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Would be | Open question |
|---|---|---|
| BR-147 | established | Must a self-reported inconclusive result be refused on a task, as it is for a phase target? No live criterion checks the task path. |
| BR-152 | established | Cited since 2026-10-12 by AC-EH-8 of `spec-evidence-labels-and-reds-are-honest`; held here until that check is recorded passing against this rule. |
| BR-159 | established | Is commit-before-attest meant to cover new untracked files, and to let a pass through when no claim exists? No live criterion runs the guard's test. |
| BR-161 | observed | Is a three-character floor with a fixed list of exceptions the intended placeholder test? |
| BR-238 | established | Which criterion, with a test that fails if the rule is false, should prove that a recorder-stated criterion revision is refused and the product stamps its own? |
| BR-252 | established | Which criterion should prove the two-runner refusal? Issue #46 also asks whether this check, built on this repository's file-naming convention, should apply to other projects at all. |
| BR-253 | established | Which criterion should prove that a test pass naming a missing test file is refused, listing every place searched? |
| BR-254 | established | Which criterion should prove that a capture which cannot start, or is stopped from outside, records nothing and is never downgraded to a typed-in row? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-145, BR-158. Each of these two lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question for each (owner: engineering): which criterion, with a test that fails if the rule is false, should establish it?
