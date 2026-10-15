---
id: BASE-104
type: baseline
role: intent
title: "Keep writes in this checkout's corpus"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
---
## Keep writes in this checkout's corpus

> An agent working in a linked worktree cannot write into the main checkout's corpus by accident.

Scope: the refusal applied when a command runs in a linked worktree that has no corpus of its own, and so reaches the main checkout's corpus. It has no command of its own: every command it guards maps its sites to this leaf. It declares unlink, the smallest guarded command, only so that its coverage is measured; the unlink behaviour itself is "Unlink two documents".

### Behaviour

**Command.** Any create, edit, delete, link or unlink, or a claim, evidence or release, run from a linked worktree with no corpus of its own.

**Constraint.** Creating, editing, deleting, linking and unlinking documents are always refused with exit code 4, and nothing is written; declaring intent does not change this (BR-802). Claim, evidence and release are allowed only when the task's claim names the worktree, which declares the intent to write there; without it they are refused with exit code 4 (BR-803). Writing a handoff or recording an acceptance-test verdict is exempt and reaches the main corpus (BR-804). The refusal is on by default in every project, including one that has only run init, and a project setting can switch it off (BR-805).

**Event.** None when refused.

### Boundary notes

- Claiming, evidence and release are execution's; only the intent rule is written here.
- One separate path lets baseline writes through: adding or changing a rule, citing a criterion and mapping a site are allowed from a worktree when a fresh claim from that worktree declares a corpus scope covering the target's branch. That path, and what it records, is product-baseline's; it does not let any of the document writes in BR-802 through.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Invalidate, restore and the migrations are not guarded (BR-806). Should they be? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-806 | unconfirmed | established | Q1: should every corpus write be guarded? |
