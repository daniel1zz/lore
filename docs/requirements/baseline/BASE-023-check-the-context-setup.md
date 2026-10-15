---
id: BASE-023
type: baseline
role: intent
title: "Check the context setup"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-139
---
## Check the context setup

> A person, agent or pre-push hook learns whether the fragments are valid, every target fits its limit, the project's rules files are in step and the assistant's language agrees with lore's.

### Behaviour

**Command.** Someone runs `fragments check`, optionally as JSON.

**Constraint.** Every target is rendered for every known helper type plus the wildcard; any finding fails the check.

**Event.** None: a read-only check.

### Terms used here

- **Lore rules file**, **stale notice**: branch glossary.

### Boundary notes

- Writing the language into the assistant's settings is distribution's (setup); this leaf only compares.
- Memory-file limits are checked by hygiene, not here.

### Current values

- Helper types: one per agent definition shipped with lore, plus subagent:* (fragments-flow.ts:352-358).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The user's lore rules files are never compared with a fresh render (BR-917). | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-916 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. Partly pinned: AC-CF-4 of `spec-context-fragments-config-driven-layered-rule-injection` — AC-CF-4 and AC-CF-18 pin a non-zero exit, not exit 4. |
| BR-917 | unconfirmed | established | Should check also verify the user's rules files? |
