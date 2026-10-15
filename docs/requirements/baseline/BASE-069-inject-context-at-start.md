---
id: BASE-069
type: baseline
role: intent
title: "Inject context at start"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-139
links:
  - {id: SPEC-083, type: supersedes}
---
## Inject context at start

> A session or a helper agent receives, as it starts, the dynamic and helper fragments that apply to it, plus a notice when the project's rules files are out of date.

### Behaviour

**Command.** A start hook asks for the injection of one target (`fragments render --outlet hook:session-start | hook:subagent-start`, optionally a helper type and a folder).

**Constraint.** The request must name a known action and, for render, a known start target; otherwise it is a usage error, exit 2, and nothing is injected (BR-912). Once a valid start target is given, the text must fit its limit (BR-907) and the injection never fails: any error becomes a short notice inside the answer, exit 0 (BR-908).

**Event.** `ContextInjected` (printed only; nothing written anywhere).

### Terms used here

- **Start-of-session injection**, **stale notice**, **audience**: branch glossary.

### Boundary notes

- The hook scripts and their registration are distribution's; this leaf is the answer they relay.
- The project pointers appended to a helper start are the pointers leaf.
- Usage errors of the fragments command as a whole (no action, or an unknown one) are held here with the render target check, because they are refused before any action runs; the check and pointers leaves cover only what their own action does (parent split notes).
- The seat block a session in a linked working copy receives at start is not part of the fragments answer: it is composed by the session-start resume hook and owned by session, leaf "Start a session" (BR-1019 moved there on 2026-10-10). It never shares the fragments answer's limit.
- Works with or without a lore project: the project is the nearest folder upward holding one, else the given folder.

### Current values

- Hook text limit 10,000 characters; the whole answer, stale notice and changed fragments included, never exceeds it (BR-909). Session start keeps 400 for the stale notice (block limit 9,600); helper start keeps 600 for the pointers (block limit 9,400) (core context-fragments.ts:15-23).
- The failure notice is at most 400 characters (fragments-flow.ts:248-251).
- The 10,000-character limit and the 400/600 split above apply to the fragments answer only (`assets/hooks/session-start-fragments.mjs`).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A hand-edited lore rules file makes every session report stale, and the advice to refresh cannot clear it (BR-910). | unconfirmed | engineering |
| Q2 | Should the start injection refuse an illegal override as refresh does (BR-911)? | undecided | product |
| Q3 | Closed 2026-10-10: BR-1019 (seat block) moved to session, "Start a session", the leaf that owns the resume hook's answer. | closed | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-910 | unconfirmed | established | Q1: should a hand-edited file be reported as hand-edited (with its own remedy) instead of stale? |
| BR-911 | unconfirmed | undecided | Q2: is the override rule meant to bind the start injection too? |
| BR-912 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
