---
id: BASE-100
type: baseline
role: intent
title: "Pull the rules before writing"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-067
links:
  - {id: SPEC-097, type: supersedes}
---
## Pull the rules before writing

> An agent about to produce something asks for the governing rules first, or for the start pack of the task or phase it is about to work on, so it does not learn the rules from a refused write.

Scope: feeding any registered checkpoint, the task-start pack and the phase-start pack. The session-resume feed belongs to session.

### Behaviour

**Command.** A caller names a checkpoint, optionally with the intended parent; or names task-start or phase-start with the task or phase.

**Constraint.** The checkpoint must be registered or one of the dedicated packs. Feeding never refuses the work it advises on.

**Event.** None in the corpus; an optional trace row records what was served.

### Terms used here

- **Feed**, **feeding pack**, **rule source**, **checkpoint**: defined in the branch glossary.

### Boundary notes

- The pack is the same one a refused write carries (BR-585, BR-586), with nothing marked missing.
- A withdrawn task gets no task-start pack; withdrawal is corpus behaviour, the refusal is this leaf's.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Length of each task-start section | project setting per section | project settings maintainer | 2026-10-09 |
| Length of each phase-start section | scope 6000, sibling phases 2000, linked knowledge 2000, latest handoff 1000 characters; not a project setting | product code | 2026-10-10 |

### Depends on

- Check a gate before writing: the rule source and pack shape.
- session (not yet written): the session-resume feed handled by the same command.
- execution: the task and plan state shown in the task-start pack.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | On the agent tool route an unknown checkpoint is answered with a note instead of being refused. Should both routes refuse? | undecided | product |
| Q2 | Suspected defect: an intended parent that cannot be found is left out of the feed with no warning (BR-594). Should the feed report it? | unconfirmed | engineering |
| Q3 | When no approved skill record applies, the feed gives only a note and leaves out the parent's summary too (BR-593). Should the parent summary still be given? | unconfirmed | product |
| Q4 | Suspected defect: an invalidated skill record can still be the one that feeds a checkpoint, if it is the most recently updated approved one (BR-595). Should invalidated skill records be excluded from feeding and from refusal packs? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-592 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-593 | unconfirmed | established | Q3: should the parent summary still be given when no rule applies? |
| BR-594 | unconfirmed | established | Q2: should an unresolvable parent be reported? |
| BR-595 | unconfirmed | established | Q4: should invalidated skill records be excluded from feeding and from refusal packs? |
| BR-599 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-600 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-601 | undecided | undecided | Q1: should the agent tool route refuse an unknown checkpoint like the command line? |

#### Evidence

| Rule | Code read | Observed in a throwaway corpus |
|---|---|---|
| BR-591 | adapters/cli/commands/feed.ts:295-342; service/checkpoint-registry.ts:2631-2633 | exit 0 and exit 2 observed |
| BR-592 | flows/feed-flow.ts:384-422 | — |
| BR-593 | flows/feed-flow.ts:391-401 | note and exit 0 observed |
| BR-594 | flows/feed-flow.ts:305-316, 406-407 | — |
| BR-595 | service/corpus-service.ts:4291-4306 (read 2026-10-10) | — |
| BR-596 | adapters/cli/commands/feed.ts:191-213 | — |
| BR-597 | flows/task-feed-flow.ts | — |
| BR-598 | adapters/cli/task-feed-wiring.ts; flows/task-feed-flow.ts | — |
| BR-599 | flows/task-feed-flow.ts:430-445, 621 | — |
| BR-600 | adapters/cli/commands/feed.ts:167-186, 350-366; flows/phase-feed-flow.ts:111-116 (section lengths, read 2026-10-10) | — |
| BR-601 | flows/feed-flow.ts:461-476; adapters/cli/commands/feed.ts:323-327 | — |
