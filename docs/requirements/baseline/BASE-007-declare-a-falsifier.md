---
id: BASE-007
type: baseline
role: intent
title: "Declare a falsifier"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-12
tags: []
parent: BASE-064
---
## Declare a falsifier

> An author declares a falsifier for a check-decided acceptance criterion.

Today a falsifier is never its own action. It is always supplied as part of declaring or revising a criterion. It is a separate leaf because it has its own event and its own rules (see the branch's split decisions).

### Behaviour

**Command.** While declaring or revising a check-decided criterion, an author supplies four parts: the file to change, the exact text to find in it, the text to replace its first occurrence with, and the expected outcome code.

**Constraint.** Check-decided criteria only; all four parts together; an exact expected outcome from 1 to 255. An expected outcome of 0, a negative number or a number above 255 is refused with exit code 4 and nothing is written, on every path that writes criteria; a stored falsifier that is not changed is not re-checked (BR-1076).

**Event.** `FalsifierDeclared`.

### Terms used here

- **Expected outcome code**: the exact whole number, from 1 to 255, the criterion's check must end with when run against the changed file. Never "any failure": a check that fails with a different code does not confirm the falsifier.
- **Stale falsifier**: a falsifier whose "text to find" is no longer in the named file. Found when the falsifier is run, never when it is declared.
- **Attested red**: the recorded result of running a falsifier. Owned by execution.

### Boundary notes

- Running a falsifier happens in a scratch copy of the project, never the working tree; that is execution's behaviour.
- The status report shows a report-only count of criteria that pass but were never observed able to fail, so an optional falsifier is nudged but not required.

### Current values

None.

### Depends on

- Declare an acceptance criterion: only check-decided criteria carry a command a falsifier can break.
- Revise an acceptance criterion: adding or changing a falsifier on an approved spec is a criterion revision and returns it to draft; declaring one together with a new criterion does not.
- execution (not yet written): runs the falsifier, refuses stale ones and records the result.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Defect, issue 29 (open). A falsifier supplied while declaring a person-decided or AI-judged criterion is silently discarded and the declaration succeeds; revising refuses the same input. Should declaring also refuse? | defect | engineering |
| Q2 | A falsifier is optional, so a criterion whose check cannot fail (see declare question 2) can still be approved. Should some spec kinds require a falsifier on every check-decided criterion before approval? | undecided | product |
| Q3 | A file outside the project or an absolute path is accepted at declaration, unlike code anchors. Running the falsifier always treats the path as relative to the project. Should declaration refuse it? | unconfirmed | engineering, product |
| Q4 | Partly resolved 2026-10-12 by `spec-evidence-labels-and-reds-are-honest` (issue 43 fixed): an expected outcome outside 1 to 255 is refused at declaration (BR-1076), and a stored 0 is refused before a falsifier run (BR-1074). Still open: the governing decision also asks for an output condition beside the code, which is not part of the declaration. | unconfirmed | engineering |



#### Downgraded in pilot v2 — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Was | Open question |
|---|---|---|
| BR-51 | established | Must a falsifier be rejected on any criterion not decided by a check, both when declaring and when revising? |
| BR-52 | observed | Must a falsifier missing any of its four parts be refused, naming the missing part? |
| BR-54 | observed | When the text to find occurs more than once, must only the first occurrence be replaced? |
| BR-57 | observed | Must declaring a falsifier leave the criterion's ordinary pass/fail check completely unchanged? |
| BR-58 | observed | Is there any supported way to change one part of a falsifier while keeping the others (expected: no)? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-55. It lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?

**BR-61 retired (2026-10-12):** it said an expected outcome of 0 or above 255 is accepted at declaration; superseded by BR-1076. Its remaining point, that no output condition is declared beside the code, stays open as Q4.

**BR-53 retired (2026-10-12):** superseded by BR-1076 (one exact expected outcome from 1 to 255; established, cited by AC-EH-3 and AC-EH-4 of `spec-evidence-labels-and-reds-are-honest`).
