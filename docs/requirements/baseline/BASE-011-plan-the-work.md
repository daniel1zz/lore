---
id: BASE-011
type: baseline
role: intent
title: "Plan the work"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-15
tags: []
parent: BASE-005
links:
  - {id: SPEC-023, type: supersedes}
  - {id: SPEC-025, type: supersedes}
  - {id: SPEC-032, type: supersedes}
  - {id: SPEC-037, type: supersedes}
  - {id: SPEC-097, type: supersedes}
---
## Plan the work

> An author lays out the work for a spec as a plan, groups it into phases, and gets the plan approved; readiness then says which of its tasks can start.

### Behaviour

**Command.** An author creates a plan under a spec (or the requirements document), adds, renames or removes phases, and asks a reviewer to approve the plan. Anyone asks which of the plan's tasks are ready.

**Constraint.** A plan is filed only under a spec, the requirements document or nothing, and a named filing location must exist and not have been removed (BR-236). A plan that declares covered criteria names only criteria of its spec, never an empty list (BR-98). Phase actions and readiness accept only a plan (BR-233). Phase names are unique per plan (BR-99); a phase still named by a task cannot be removed (BR-101), and removing or renaming a phase the plan does not declare is refused (BR-234). Phase edits never change the plan's status (BR-100). A plan with no spec above it is approved with no plan condition checked (BR-97, BR-107; Q5). When a spec is above it, approval needs that spec to count as approved, which means its status is approved or active (BR-104), to declare at least one criterion (BR-105), and, where the spec's kind demands acceptance testing, the plan to declare it (BR-106). These conditions apply whether the plan is approved through review or its status is set to approved directly, since that route runs the same approval path (BR-1071 on "Approve a document"; BR-103, BR-105 and BR-106 still say "through review", see Q6). Readiness is computed on request from task status and blocking links only.

**Event.** `PlanCreated`, `PhaseAdded`, `PhaseRenamed`, `PhaseRemoved`, `PlanApproved`. Readiness raises no event: it is a query.

### Terms used here

- **Member task**: a task that names this plan as its own. Membership follows that declaration, not where the task is filed.
- **Blocker**: a task linked as blocking another. Only an archived blocker stops blocking.
- **Ready**: not archived or deprecated, and every blocker archived. Never stored; computed each time.
- **Upstream warning**: a flag on every task of a plan whose spec does not count as approved (neither approved nor active, BR-104). It never changes readiness.
- **Covered criteria**: the subset of the spec's criteria a plan declares it covers.
- **Claim display**: readiness also shows each task's claim with its age in minutes and whether it is stale, using claim-a-task's claim lifetime (BR-126). This is information only: a claim, fresh or stale, never changes readiness (BR-111).

### Boundary notes

- Plan approval also passes through the review branch's judgment conditions; only the plan-specific conditions are owned here.
- Closing a plan (every task archived, attestation floor, domain sync) belongs to the close-a-plan leaf, not here.
- Readiness for ad-hoc tasks is a separate listing of open ad-hoc tasks; they belong to no plan.
- Approval prints early warnings (for example, that no task under the plan can ever be verified by a run) without refusing; those are advisory and are not rules here.
- A separate phase document type also exists, with its own claim and evidence. No leaf of the execution branch describes it, and no other branch does yet (see the execution branch's open question). The phases described here are named groupings on a plan, not those documents.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether plan approval checks run at all | on (new project and this repository) | project settings maintainer | 2026-10-08 |
| Whether the acceptance-testing part runs | on | project settings maintainer | 2026-10-08 |
| Which spec kinds require acceptance testing | New project: none. This repository: design | project settings maintainer | 2026-10-08 |
| Claim lifetime behind the stale mark in the claim display | 120 minutes (new project and this repository), the same value as claim-a-task's claim lifetime (BR-126) | project settings maintainer | 2026-10-08 |

### Depends on

- Approve a spec (specification): a spec's approval is what plan approval waits for (BR-72, BR-77, BR-81 — an approved spec can return to draft and silently stall its plans).
- Declare an acceptance criterion (specification): what counts as a declared criterion (BR-15, BR-20).
- Create a task (BR-113, BR-116): membership and phase naming.
- Claim a task (BR-126): when a claim counts as stale in the claim display.
- Archive a task (execution, other leaf): archival is the only way a blocker stops blocking.
- Close a plan (execution, other leaf).
- review, "Approve a document" (BR-1071): setting a plan's status to approved directly runs the same approval path, so the plan conditions apply on that route too.
- review (other leaves): review judgment mechanics.
- corpus (not yet written): body edits return an approved plan to draft.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Resolved 2026-10-12 by `spec-approval-and-plan-closure-go-through-the-same-checks-on` D1: setting a plan's status directly to approved runs the approval path, so every plan condition applies on that route on every surface, as for specs (BR-1071 on "Approve a document"; issue 50 fixed). BR-108, which described the skip, was retired on 2026-10-12, superseded by BR-1071. | resolved | product, engineering |
| Q2 | A deprecated blocker keeps blocking forever (BR-110), while the archival notes describe deprecated as terminal for readiness. Which is intended? | unconfirmed | product |
| Q3 | Renaming a phase rewrites member tasks without a history entry or a concurrency check (BR-102). Should each task change be recorded? | defect | engineering |
| Q4 | Answered 2026-10-15 by `spec-an-active-spec-counts-as-approved-for-claiming-its-tasks`: an active spec counts as approved for plan approval and for claiming its tasks (BR-104). | answered | product |
| Q5 | A plan with no parent passes every plan condition (BR-97, BR-107). Should a plan be required to sit under a spec once specs hang under baseline leaves (ADR-041)? | undecided | product |
| Q6 | BR-103, BR-105 and BR-106 still limit the plan conditions to approval "through review", while BR-1071 applies them to a direct status change too. Should the three rules be reworded to every approval route? | undecided | engineering |
| Q7 | BR-103 still says the spec above the plan must be "approved and not deleted", while BR-104 (reworded 2026-10-15) counts an active spec as approved too. Should BR-103 defer to BR-104's definition? | undecided | engineering |
| Q8 | BR-104 is now cited by AC-ACT-1 and AC-ACT-2 of `spec-an-active-spec-counts-as-approved-for-claiming-its-tasks` but is still held at unconfirmed. Do those criteria fail if the rule is false, so that it can be raised to established? | unconfirmed | engineering |

#### Held at unconfirmed — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Would be | Open question |
|---|---|---|
| BR-97 | observed | Is a plan with no parent at all meant to be legal? It silently passes every plan-approval and claim condition that depends on a spec. |
| BR-99 | observed | Are case-different phase names on one plan meant to be allowed, and must refusing a duplicate or empty name stay a hard refusal? |
| BR-101 | observed | Should archived tasks keep a phase from being removed, given that a closed plan's history depends on the name? |
| BR-112 | observed | Must a retracted task drop out of readiness while an archived one stays listed as not ready? |
| BR-233 | established | Which criterion, with a test that fails if the rule is false, should prove that phase actions and readiness refuse a document that is not a plan and change nothing? |
| BR-234 | established | Which criterion should prove that removing or renaming an undeclared phase is refused, naming the phase, with nothing changed? |
| BR-236 | established | Which criterion should prove that a missing or removed filing location for a plan is refused as not found, with nothing created? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-103, BR-104, BR-105, BR-107, BR-111. Each of these five lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question for each (owner: engineering): which criterion, with a test that fails if the rule is false, should establish it? BR-104 was reworded on 2026-10-15 (active counts as approved) and is now cited by AC-ACT-1 and AC-ACT-2 of `spec-an-active-spec-counts-as-approved-for-claiming-its-tasks`; its level has not been re-assessed against those criteria (Q8).
