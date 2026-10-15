---
id: BASE-026
type: baseline
role: intent
title: "See who owns each branch"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-027
links:
  - {id: SPEC-095, type: supersedes}
---
## See who owns each branch

> Before merging, rescuing or deleting a branch, a session checks whose it is, and acts only on its own or on nobody's.

Scope: the territory. Process liveness is "See who is working".

### Behaviour

**Command.** A session asks for the territory.

**Constraint.** Every worktree of the repository, and every local branch when the branches can be listed, lands in exactly one bucket, judged against the claims of the whole corpus (BR-389). If local branches cannot be listed, unclaimed branches that are not checked out are missing and nothing says so (BR-398). Ownership compares session ids, never identities; an unknown session id never counts as the caller's own.

**Event.** None recorded; this is a read.

### Terms used here

- **Territory**, **mine / foreign**, **unowned / unmeasured**, **stale**: defined in the branch glossary.

### Boundary notes

- Claims carry the session id and branch they were made from; that capture is execution's ("Claim a task").
- A seat branch left behind after removal shows as unowned (BR-376).
- The two suspected defects of this leaf, BR-397 and BR-398, were read from the code and not reproduced. The parent's statement that its suspected defects were also reproduced on a throwaway corpus does not cover them, and the parent's list of known suspected defects names BR-398 but not BR-397. Both points are the parent's to correct.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Branch unmerged commits are counted against | main | engineering (code) | 2026-10-09 |

### Depends on

- execution, "Claim a task": claims with session id, worktree and branch.
- See who is working: the same sessions.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A worktree is matched to claims by its exact path; a claim made through another spelling of the path leaves it unowned. Should paths be compared after resolving links? | unconfirmed | engineering |
| Q2 | When local branches cannot be listed, the output does not say so, and unclaimed branches are missing from the territory. Should it say so? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-392 | unconfirmed | established | Which criterion, with a test that fails if the rule is false, should establish it? (See the citation audit note below.) |
| BR-393 | unconfirmed | established | Should an unusable session id be reported rather than silently treated as absent? |
| BR-395 | unconfirmed | established | Which criterion, with a test that fails if the rule is false, should establish it? (See the citation audit note below.) |
| BR-396 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-397 | unconfirmed | undecided | Should worktree paths be compared after resolving links, or the branch be used as a second key (Q1)? |
| BR-398 | unconfirmed | undecided | Should the territory state that branch listing failed (Q2)? |
| BR-399 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-392, BR-395. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1).
