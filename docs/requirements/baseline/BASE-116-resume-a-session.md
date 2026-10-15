---
id: BASE-116
type: baseline
role: intent
title: "Resume a session"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-027
links:
  - {id: SPEC-095, type: supersedes}
---
## Resume a session

> A session picks up a thread from the handoff the user points it at, or from the newest one.

Scope: the session-resume checkpoint of the feed command, including what the ticket shows about the plan it belongs to (its readiness counts, and the rule changes under its claimed tasks). The feed command's other checkpoints belong to autonomy.

### Behaviour

**Command.** A session asks to resume, naming a handoff directly, or a plan, or nothing, and optionally the identity whose handoffs it wants.

**Constraint.** A name that matches nothing, or the wrong kind of document, is refused. Otherwise the newest matching handoff is chosen, or one per identity when several identities left handoffs. When the resume belongs to a plan (the plan named, or else the plan of the single handoff shown), the ticket also lists, for each claimed task of that plan that is not archived or deprecated (only the given identity's claims when an identity is named), the rules cited by its spec's criteria whose statement, confidence or lifecycle changed since the claim, or one line saying none changed (BR-966). With no plan named, a ticket that shows no handoff or several identities' handoffs has no such list. If the list cannot be made, the whole resume fails and no ticket is printed (BR-972).

**Event.** None recorded in the corpus; this is a read.

### Terms used here

- **Resume ticket**, **ticket item**, **accounting duty**: defined in the branch glossary.

### Boundary notes

- The ticket's numbered items and the accounting declaration create the duty checked by "Account for a resume ticket".
- The snapshot's resume pointer ("Start a session") skips closed handoffs; resuming does not (BR-354).
- The rule-change list is shown here so a session that picks up claimed work learns what moved under it before it continues. Claims themselves belong to execution ("Claim a task"); which rules a criterion cites belongs to the product baseline ("Cite a baseline rule").

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Age after which a handoff is flagged as old | 7 days (10,080 minutes) | project settings maintainer | 2026-10-09 |

### Depends on

- Hand off a session: the handoffs resumed.
- execution: the plan readiness counts, and the claims of the plan's tasks ("Claim a task").
- product baseline: the rules a task's spec cites ("Cite a baseline rule") and their earlier values, read from the history of the leaf that holds them.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Resuming by newest considers archived, deprecated and invalidated handoffs, unlike the snapshot. Which is meant? | unconfirmed | product, engineering |
| Q2 | The rule that leaves out the accounting declaration for a handoff the same session just wrote (BR-351) has no criterion; it was decided in a task only. Should it become part of a spec? | undecided | product |
| Q3 | When the rule-change list cannot be made for one claimed task, the whole resume fails and no ticket is printed (BR-972). Should the ticket still be shown, with the failure named? | undecided | product, engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-966 and BR-972 on 2026-10-10), but no live check-decided criterion names a test that would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-347 | unconfirmed | established | Which criterion, with a test that fails if the rule is false, should establish it? (See the citation audit note below.) |
| BR-351 | unconfirmed | established | Should the same-session exemption become part of a spec (Q2)? It is pinned by a test that no criterion names. |
| BR-353 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-354 | unconfirmed | undecided | Should resuming skip closed handoffs the way the snapshot does (Q1)? |
| BR-966 | unconfirmed | established | No question about intent: added on 2026-10-10 (BL-15). It is held until its criterion AC-BLS2-22 is recorded as passing. |
| BR-972 | unconfirmed | established | Should a failed rule-change list fail the whole resume (Q3)? Read from the code on 2026-10-10; no criterion checks it. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-347. It lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1).
