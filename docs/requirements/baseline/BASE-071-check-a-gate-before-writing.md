---
id: BASE-071
type: baseline
role: intent
title: "Check a gate before writing"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-067
links:
  - {id: SPEC-094, type: supersedes}
---
## Check a gate before writing

> An agent, a hook or a person learns a checkpoint's answer before attempting a write, and every checkpoint refuses, skips and records in the same way, so work can advance unattended without breaking the rules.

Scope: what all checkpoints do alike, on the pre-flight check and on real writes. Each checkpoint's own conditions belong to the leaf whose action it guards: spec creation and approval (specification), plan approval, task creation, claims and plan closing (execution), the review-judgment checkpoint (review).

### Behaviour

**Command.** A caller runs the pre-flight check of one checkpoint, against a candidate spec or an existing spec, plan, task or phase. On real writes in other branches the same checkpoints run by themselves. Where a project registers them, the shipped agent pre-checks (the `lore-gate-g1` to `g4` hooks) run the pre-flight check before an agent's command reaches the write.

**Constraint.** On a real write a switched-off checkpoint is skipped and the skip is audited (BR-581); a pre-flight check of a switched-off checkpoint answers pass with no audit entry (BR-582, Q1). The bypass variable affects pre-flight checks only (BR-578, BR-580). A refusal carries its reasons and a feeding pack (BR-584, BR-585).

**Agent pre-checks.** A shipped pre-check judges a command against the corpus it targets: a leading `cd <dir> &&` or `cd <dir> ;` makes that directory's corpus the target, and a target with no corpus lets the command through. It reacts only to the trigger at a command position, never to quoted text. When it cannot find a document the command names in that corpus, it lets the command through and leaves the decision to the write's own checkpoint. It writes nothing (BR-1020).

**Event.** `GatePassed` and `GateSkipped` (audit entries on real writes; a bypassed pre-flight check also records `GateSkipped`). A refusal records no audit entry.

### Terms used here

- **Checkpoint**, **pre-flight check**, **feeding pack**, **rule source**, **gate bypass variable**, **switched-off checkpoint**: defined in the branch glossary.

### Boundary notes

- Feeding the same rules before any attempt is the leaf "Pull the rules before writing"; the pack is built the same way (BR-592).
- Installing and registering the agent pre-check hooks is distribution's; this leaf holds only how a registered pre-check decides.
- The plan-closing checkpoint has no pre-flight check; its explanation table is offered here, its conditions are execution's.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether each checkpoint is on | on for every checkpoint (new project and this repository) | project settings maintainer | 2026-10-09 |
| Pre-flight bypass | off unless the environment sets it | whoever runs the check | 2026-10-09 |

### Depends on

- Create a spec, Approve a spec (specification); Plan the work, Create a task, Claim a task, Close a plan (execution); Approve a document (review): the conditions.
- Pull the rules before writing: the same rule source and pack.
- issue-loop (not yet written): the report hint after a refusal.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A pre-flight check of a switched-off checkpoint answers 0 without resolving its target and without an audit entry, while a skip on a real write is audited. Should it be audited too? | undecided | product |
| Q2 | In a fresh project the pre-flight pack tells the reader to run a seeding script that exists only in Lore's own repository; the write-path pack uses a built-in fallback text instead. | unconfirmed | engineering |
| Q3 | A refusal leaves no audit entry, only an optional trace row. Should refusals be auditable like passes and skips? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-1020 on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`); `observed` is used for a rule measured in code that no criterion cites yet. Every rule of this leaf held below established is listed here; BR-579, BR-581, BR-583 and BR-585 are established.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-576 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-577 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-578 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-580 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-582 | unconfirmed | established | Should a disabled pre-flight check be audited like a disabled write (Q1)? |
| BR-584 | unconfirmed | established | Should a refusal leave an audit entry, as passes and skips do (Q3)? |
| BR-586 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-587 | unconfirmed | established | Should the pre-flight pack use the same built-in fallback as the write (Q2)? |
| BR-588 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-589 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-590 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-1020 | observed | established | No question about intent; read from the shipped hooks (see Evidence). Waiting for a check-decided criterion that runs a pre-check with a `cd` prefix to a corpus-less folder, a quoted trigger and an unknown document, and fails if any of them is blocked. |

#### Evidence

| Rule | Code read | Observed in a throwaway corpus |
|---|---|---|
| BR-576 | adapters/cli/commands/gate.ts:661-733, 835-865, 926-1050, 1083-1166, 1207-1260 | exit 0 and exit 4 observed |
| BR-577 | adapters/cli/commands/gate.ts:383-398, 838-845, 929-950, 1086-1107, 1210-1228 | exit 3, 4 and 2 observed |
| BR-578 | adapters/cli/commands/gate.ts:373-377, 428-432, 462-466, 505-509, 550-554 | exit 0 observed for an unknown target and for invalid input |
| BR-579 | adapters/cli/gate-bypass-audit.ts:20-60; adapters/cli/commands/gate.ts:260-279 | audit entry observed |
| BR-580 | service/gate-enforcer.ts:64-96, 680, 695 | refusal with the note observed, exit 4, no audit entry |
| BR-581 | service/gate-enforcer.ts:596-599, 791-799 | — |
| BR-582 | adapters/cli/commands/gate.ts:625-635 | exit 0, no audit entry, unknown target not resolved |
| BR-583 | service/gate-enforcer.ts:644-647, 821-828 | 'gate_passed, task-create' observed |
| BR-584 | service/gate-enforcer.ts:675-700 | exit 4, no audit entry observed |
| BR-585 | service/gate-feeding.ts:118-128 (pack built with its source), 147-160 (rendered pack always leads with the source); service/checkpoint-registry.ts:2454-2482 (the feed callback of every checkpoint) | built-in fallback source observed |
| BR-586 | service/corpus-service.ts:4483-4497; adapters/cli/commands/gate.ts:1332-1345 | — |
| BR-587 | adapters/cli/commands/gate.ts:315, 1334-1336 | placeholder text observed in a fresh corpus |
| BR-588 | adapters/cli/commands/gate.ts:1277-1296 | — |
| BR-589 | adapters/cli/commands/gate.ts:812-820 | — |
| BR-590 | adapters/cli/commands/gate.ts:590-608 | exit 2 observed |
| BR-1020 | assets/hooks/lore-gate-g4-task-claim.sh:72-95 (leading `cd` target), 105-128 (command-position trigger, quotes ignored), 212-217 (no corpus: let through), 265-271 (document not found: let through); the same shape in lore-gate-g1 to g3 | — |
