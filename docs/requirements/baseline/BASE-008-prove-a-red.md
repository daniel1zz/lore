---
id: BASE-008
type: baseline
role: intent
title: "Prove a red"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-12
tags: []
parent: BASE-005
---
## Prove a red

> The runner shows that a criterion's check can fail. It applies the declared falsifier in a throwaway copy and records the red only when the check fails exactly as declared.

### Behaviour

**Command.** A person or agent asks the runner to prove the red of one named criterion of a plan's spec, optionally naming the target task.

**Constraint.** The criterion is decided by a check and declares a falsifier (BR-185, BR-248); the throwaway copy can be made and the change written into it (BR-249); the change happens only in a throwaway copy; the unchanged check passes there first; the changed check ends with exactly the declared code, and that failure is a real one: a changed check that fails only because the runner found no tests, or ends with exit code 126 or 127, is recorded as inconclusive, never as a red, even when the code equals the declared one (BR-1075). A stored expected outcome of 0 is refused with exit code 4 before anything runs, naming the command that corrects it (BR-1074). A changed check that cannot even be started (no process runs) aborts the run and records nothing (BR-193); that is distinct from a check that starts and ends 126 or 127, which is recorded as inconclusive (BR-1075).

**Event.** `RedAttested` (an expected-fail row with a runner record), or `RedInconclusive` (the control failed, BR-189; or the changed check found no tests or ended 126 or 127, BR-1075). An inconclusive row is labelled runner-unattested: observed by the runner but carrying no runner record, distinct from both a runner-attested row and a self-report, and never counted as attested (BR-1073 for the failed-control row, BR-1075 for the changed-check row).

### Terms used here

- **Throwaway copy**: a fresh copy of the project made for one run and removed afterwards. Every check of this leaf runs only there.
- **Control**: the criterion's unchanged check, run in the throwaway copy before anything is changed. A failed control means the copy itself cannot run the check.
- **Attested red**: an expected-fail row carrying a runner record. It is produced only by this leaf.
- **Stale falsifier**: see the specification branch. Here it is found at run time.

### Boundary notes

- Declaring, revising and validating a falsifier belongs to the specification branch (BR-51 to BR-60 and BR-1076; BR-61 retired 2026-10-12, superseded by BR-1076). This leaf only runs it.
- BR-56 (specification) says a falsifier is optional and that running a missing one is refused. BR-248 is the same refusal seen from the run: it happens before a target task is chosen or a copy is made, records nothing, and tells the caller how to declare one. BR-56 owns whether a falsifier must exist; this leaf owns what the run does when it does not.
- Target-task resolution is the same as for verification (BR-162). Scope selection and command approval are not applied (BR-194).
- The environment allow-list (BR-182) also applies to both runs in the copy.
- The order of the checks matters. A stale falsifier hidden behind a failing control produces an inconclusive row, not a stale refusal (BR-190).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Time limit for the control and for the changed check | the criterion's own limit, else the project default of 15 minutes | project settings maintainer | 2026-10-08 |
| Maximum length of the recorded output | 4000 characters (fixed in the product) | engineering | 2026-10-08 |

### Depends on

- run-verification: BR-162 (target task), BR-174 (time limit), BR-182 (environment).
- claim-a-task: when no task is named, the target is the plan's only task with a fresh claim (BR-162), and freshness is the claim lifetime (BR-126).
- BR-1076 (one exact expected outcome code from 1 to 255; it superseded BR-53, retired 2026-10-12), BR-54 (only the first occurrence is replaced), BR-55 (staleness is found at run time), BR-56 (a criterion without a falsifier is refused, naming the missing declaration).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Unknown criterion, wrong mode and missing plan refusals have no live oracle (BR-185). | undecided | engineering |
| Q2 | A launch failure of the changed check (no process runs) leaves no trace, while the same failure of the control is recorded (BR-193). Since 2026-10-12 a changed check that starts and ends 126 or 127 is recorded as inconclusive (BR-1075), so the asymmetry now covers only a true launch failure. Is it intended? | undecided | product |
| Q3 | A red is recorded on the target task even when that task does not own the criterion (BR-194). | undecided | product |
| Q4 | Resolved 2026-10-12 by `spec-evidence-labels-and-reds-are-honest` D1 and D11: a failed-control row, and a changed-check row that found no tests or ended 126 or 127, are recorded inconclusive with the label runner-unattested, never runner and never attested (BR-1073, BR-1075; issues 48 and 53 fixed). BR-195, which described the false runner label, was retired on 2026-10-12, superseded by BR-1073. | resolved | engineering |
| Q5 | Proving a red from the main copy ignores its uncommitted changes. A red can therefore be proved against code that differs from what the author is looking at (BR-187). | undecided | product |
| Q6 | The refusal for a criterion with no falsifier (BR-248) and the refusal when the copy cannot be made or the change cannot be written (BR-249) have no live criterion. Which criterion, with a test that fails if the rule is false, should establish each? | unconfirmed | engineering |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-190 (the only rule of this leaf affected). It lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question (owner: engineering): which criterion, with a test that fails if the rule is false, should establish it?
