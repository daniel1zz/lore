---
id: BASE-063
type: baseline
role: intent
title: "Create a task"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-10
tags: []
parent: BASE-005
links:
  - {id: SPEC-023, type: supersedes}
---
## Create a task

> An author adds one unit of work to a plan, says which criteria it will prove and which files it will touch.

### Behaviour

**Command.** An author creates a task naming its plan (or marks it ad-hoc), optionally a phase, its criteria scope and its file anchors; later edits the scope or the anchors.

**Constraint.** A task names its plan unless ad-hoc; it is filed under a plan; its phase must be declared by the plan it names; it must declare a scope when the plan's spec has check-decided criteria; the filing location must be an existing plan, or the requirements document for an ad-hoc task (BR-235); anchors must be valid project-relative locations. Scope ids are added or removed only on tasks (BR-256), at least one non-blank id per request (BR-255), and ids that already have evidence cannot be removed (BR-120).

**Event.** `TaskCreated`, `TaskScopeChanged`, `TaskAnchorsChanged`.

### Terms used here

- **Declared plan**: the plan a task names as its own; decides membership, phase checking and readiness.
- **Filing plan**: the plan a task is stored under. Normally the same as the declared plan; they can differ.
- **Ad-hoc task**: a task belonging to no plan, filed under the requirements document.
- **Criteria scope**: the spec criteria a task says it will prove. Never declared and declared-empty are different states.
- **File anchor**: a project-relative file or folder a task will touch; used to keep concurrent claims apart.

### Boundary notes

- Generic document creation (title, body, links, ids) is the corpus branch; only task-specific conditions are here.
- Anchors are checked for shape here; whether they overlap other work is decided when claiming.
- Scope ids are not checked against the spec here; a verification run refuses ids that name nothing (run-verification leaf).
- Several conditions are enforced only on the command line (BR-115, BR-118); other routes accept the same input.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether the scope-at-creation check runs | on (new project and this repository) | project settings maintainer | 2026-10-08 |
| Most scope ids per task | 50 (fixed) | engineering | 2026-10-08 |
| Most file anchors per task, and longest anchor | 50 anchors, 512 characters (fixed) | engineering | 2026-10-08 |

### Depends on

- Plan the work (BR-97, BR-99): the plan and its phases.
- Declare an acceptance criterion (specification): what a check-decided criterion is (BR-20); ids unique only within a spec (BR-23).
- Claim a task (BR-130, BR-133): what anchors are for.
- Claim a task (BR-129): a claim checks the spec above the filing plan, as Q3 notes.
- Record evidence (BR-156): evidence references a criterion, which freezes it in the scope (BR-120). A row's criterion reference resolves through the filing plan, not the declared plan (BR-157), as Q3 notes.
- Run verification (execution, other leaf): consumes the scope and refuses undeclared or empty scopes.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Ad-hoc exclusivity and the ad-hoc scope requirement hold only on the command line (BR-115, BR-118). Should every route enforce them? | undecided | engineering |
| Q2 | Scope ids are accepted without checking the spec (BR-121). Should an id naming no criterion be refused when declared? | undecided | product |
| Q3 | A task's declared plan and filing plan can differ; phase and readiness follow the declared plan while evidence and claim checks follow the filing plan (BR-157, BR-129). Should the two be forced equal? | undecided | product, engineering |

#### Held at unconfirmed — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Would be | Open question |
|---|---|---|
| BR-116 | established | Must a task's phase be checked against the plan it declares rather than the one it is filed under, on every write route? |
| BR-117 | established | Is requiring a declared scope (possibly empty) at task creation the intended rule, given no live criterion currently exercises it? |
| BR-118 | observed | Should the ad-hoc scope requirement hold on every route, not only the command line? |
| BR-121 | observed | Is accepting a scope id that names no criterion, and refusing it only at verification time, the intended trade-off? |
| BR-115 | observed | Covered by Q1: should ad-hoc exclusivity hold on every route, not only the command line? |
| BR-123 | established | Should a non-existent anchor stay a warning only, or be refused once the task is claimed? |
| BR-235 | established | Which criterion, with a test that fails if the rule is false, should prove that a missing, removed or wrong-kind filing location is refused with nothing created? |
| BR-255 | established | Which criterion should prove that a scope add or remove naming no id, or a blank id, is refused and leaves the task unchanged? |
| BR-256 | established | Which criterion should prove that scope add and remove refuse any document that is not a task, pointing plans to a general field edit? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-113 (the only rule of this leaf affected). It lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question (owner: engineering): which criterion, with a test that fails if the rule is false, should establish it?
