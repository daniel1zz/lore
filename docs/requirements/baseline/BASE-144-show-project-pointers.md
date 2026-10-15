---
id: BASE-144
type: baseline
role: intent
title: "Show project pointers"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-139
---
## Show project pointers

> A helper agent's start text gets a few lines naming the corpus root, the open plan and the review backlog, so it knows where to look.

### Behaviour

**Command.** A start hook asks for the pointers of a folder (`fragments pointers --cwd`).

**Constraint.** Only inside a lore project, and only from a readable corpus snapshot. Kept within the pointer limit. Never fails loudly.

**Event.** None: printed only.

### Terms used here

- **Project pointers**: branch glossary.

### Boundary notes

- The snapshot itself (what counts as root, open plan, waiting for review) is session's, leaf "Start a session" (BR-320 on the live corpus).

### Current values

- Pointer limit: 600 characters (core context-fragments.ts:17). The snapshot is given 5 seconds (fragments.ts:64).


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-918 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-919 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
