---
id: BASE-069
type: baseline
role: intent
title: "Inject context at start"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-15
tags: []
parent: BASE-139
links:
  - {id: SPEC-083, type: supersedes}
---
## Inject context at start

> A helper agent receives, as it starts, the helper fragments that apply to it. The main session's start no longer receives fragments: its start-of-session target and its stale notice are retired.

### Behaviour

**Command.** The helper start hook (`assets/hooks/subagent-context.mjs`) asks for the injection of the helper-start target (`lore fragments render --outlet hook:subagent-start`, optionally a helper type and a folder).

**Constraint.** The request must name a known action and, for render, the helper-start target; a missing or unknown action or target is a usage error, exit 2, listing what is accepted, and nothing is injected. The retired session-start target (`hook:session-start`) is refused the same way, naming that it is retired (BR-912). Once the target is accepted, the text must fit its limit, the hook limit less the room kept for the pointers (BR-907), and the injection never fails: any error becomes a short notice inside the answer, exit 0 (BR-908).

**Event.** `ContextInjected` (printed only; nothing written anywhere).

### Terms used here

- **Audience**: branch glossary.
- **Helper start**: the moment a helper agent the session started begins work; the only start this leaf injects into.

### Boundary notes

- The hook scripts and their registration are distribution's; this leaf is the answer they relay.
- The project pointers appended to a helper start are the pointers leaf.
- Usage errors of the fragments command as a whole (no action, or an unknown one) are held here with the render target check, because they are refused before any action runs; the check and pointers leaves cover only what their own action does (parent split notes).
- Retired on 2026-10-15 by `spec-one-upgrade-reminder-at-session-start-covers-the-global`: the session-start target, its stale notice and the changed rule text it injected (BR-909, BR-910), and the hook that asked for it (`session-start-fragments.mjs`). Outdated or hand-edited project rules files are now reported by the project check ("Check installation freshness", BR-1085), and the session is told which command to run by one advisory line ("Start a session", BR-1086). A dynamic main-session fragment, which only that target delivered, is now a finding of the context check ("Check the context setup", BR-1066).
- The context branch's Inside list, children table, diagram and known-defects note still describe the session-start injection, its stale notice and BR-910; updating them is a change to the parent, not to this leaf.
- What a main session does receive at start (the seat block, the compact snapshot and the advisory) is composed by the session-start resume hook and owned by session, leaf "Start a session". It never shares this leaf's limit.
- Works with or without a lore project: the project is the nearest folder upward holding one, else the given folder.

### Current values

- Hook text limit 10,000 characters; helper start keeps 600 of it for the pointers, so the fragment text may use at most 9,400 (BR-907; core context-fragments.ts:15-24).
- The failure notice is at most 400 characters; it replaces the fragment text and is not reserved out of the limit (core context-fragments.ts:19-22; fragments-flow.ts).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Answered 2026-10-15 by `spec-one-upgrade-reminder-at-session-start-covers-the-global`: the stale notice a hand-edited rules file could never clear is retired with BR-909 and BR-910; a hand-edited file is now reported as diverged by the project check and named in the session-start advisory, never advised to be overwritten. | answered | engineering |
| Q2 | Should the helper-start injection refuse an illegal override as refresh does (BR-911)? BR-911 still says the override is applied "at session and helper start"; since the session-start target is retired, only helper start can apply it, and the rule's wording has not been narrowed yet. | undecided | product |
| Q3 | Answered 2026-10-10: BR-1019 (seat block) moved to session, "Start a session", the leaf that owns the resume hook's answer. | answered | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-911 | unconfirmed | undecided | Q2: is the override rule meant to bind the helper-start injection too? |
| BR-912 | unconfirmed | established | No question about intent. Reworded on 2026-10-15 (session-start target retired) and now cited by AC-UR-3 of `spec-one-upgrade-reminder-at-session-start-covers-the-global`; its level has not been re-assessed against that criterion. |
