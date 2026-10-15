---
id: BASE-021
type: baseline
role: intent
title: "Claim a task"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-12
tags: []
parent: BASE-005
links:
  - {id: SPEC-025, type: supersedes}
  - {id: SPEC-095, type: supersedes}
  - {id: SPEC-097, type: supersedes}
---
## Claim a task

> An agent takes an advisory lease on a task before working on it, and gives it back when done.

### Behaviour

**Command.** An agent claims a task, optionally naming its version-control branch, machine and working copy, and optionally declaring which branch of the product baseline that working copy may write (BR-237), or steals a fresh claim; the holder (or anyone, forced) releases it.

**Constraint.** No fresh claim by someone else unless stolen; the spec above the plan must be approved; anchors must not overlap a fresh claim by another actor or another session in the same plan; an identity that fell back to the computer's user name must not collide with the same name elsewhere; the working copy is never inferred; a baseline-branch declaration needs a named working copy and must name a baseline branch, not any other document or baseline level, or nothing is claimed (BR-237). Release only by the holder unless forced, and not while the claimed working copy has uncommitted changes.

**Event.** `TaskClaimed`, `ClaimRefreshed`, `ClaimStolen`, `ClaimReleased`.

### Terms used here

- **Claim (lease)**: who works on a task and since when. Advisory: it does not lock the task's content.
- **Claim lifetime**: how long a claim stays fresh without renewal. Past it, the claim is stale and anyone may take it.
- **Steal**: overriding a fresh claim on the same task; never bypasses an overlap with another task.
- **Session**: the running agent session that made a claim, recorded automatically.
- **Working copy**: the checkout a claim says the work happens in; stated, never inferred.
- **Baseline branch declaration**: the branch of the product baseline a claim says its working copy may write. Distinct from the version-control branch the claim records (BR-137).

### Boundary notes

- Archiving a task after work (and the refusal under a fresh foreign claim) is the archive-a-task leaf.
- Evidence renews the holder's claim (BR-141); the evidence rules themselves are in record-evidence.
- Session listings and liveness reports are the session branch; this leaf only owns what a claim records.
- A release is refused for uncommitted changes (BR-144); the same guard on a pass row is BR-159.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Claim lifetime | 120 minutes (new project and this repository) | project settings maintainer | 2026-10-08 |
| Whether claim checks run at all | on | project settings maintainer | 2026-10-08 |
| Whether the anchor-overlap part runs | on | project settings maintainer | 2026-10-08 |
| Whether the identity-collision part runs | on | project settings maintainer | 2026-10-08 |

### Depends on

- Plan the work (BR-104): what counts as an approved spec.
- Create a task (BR-122): anchor shape.
- Record evidence (BR-159): the same uncommitted-changes guard.
- Archive a task (execution, other leaf): release does not archive.
- Approve a spec (specification, BR-81): an approved spec returning to draft blocks every new claim under it.
- session (not yet written): identity resolution and session listing.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Claiming ignores the task's status, readiness and retraction (BR-140). Should an archived, blocked or retracted task be claimable? | unconfirmed | product |
| Q2 | Two sessions sharing one explicit identity are refused only on an anchor overlap with an unmeasured or different session (BR-131, BR-135). Should identity sharing itself be refused? | undecided | product, engineering |
| Q3 | Untracked files block a release (BR-144) although the guard is described as covering tracked changes. Which is intended? | unconfirmed | engineering |
| Q4 | Active is a separate status a spec can move to after approved, not a synonym for it. A task under such an active spec cannot be claimed, because only exactly approved counts (BR-129 with BR-104). Intended? | undecided | product |

#### Held at unconfirmed — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Would be | Open question |
|---|---|---|
| BR-138 | established | Is refusing a claim on an unusable session identifier the intended behaviour, rather than recording the claim as unmeasured? |
| BR-139 | observed | Is a double rollback, where neither racing claim survives, acceptable as the residual? |
| BR-144 | established | Should untracked files block a release, as they do today, although the guard is described as covering changes to tracked files? |
| BR-237 | established | Which criterion, with a test that fails if the rule is false, should prove that a baseline-branch declaration without a working copy, or naming something other than a baseline branch, is refused with nothing claimed? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-125, BR-126, BR-129, BR-131, BR-142, BR-143. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question for each (owner: engineering): which criterion, with a test that fails if the rule is false, should establish it?
