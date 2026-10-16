---
id: BASE-141
type: baseline
role: intent
title: "Create the project memory file"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-15
tags: []
parent: BASE-139
---
## Create the project memory file

> A person or agent gives a project its first memory file: a managed part lore will keep up to date, and a hand-written part for the project's own rules.

### Behaviour

**Command.** Someone asks to create the project memory file (`context init`), optionally asking for or refusing AI for the hand-written part, or forcing a re-run on an existing file.

**Constraint.** Only inside a lore project. Refused when the file exists, unless forced. AI is used only when it is on for this caller; any AI failure falls back to a placeholder with a warning.

**Event.** `ProjectMemoryFileCreated` (a file on disk; nothing in the corpus).

### Terms used here

- **Project memory file**, **managed part**, **hand-written part**: branch glossary.

### Boundary notes

- Creation writes no lore rules files and applies no size or structure check; both happen on the first refresh (refresh leaf, rules-file leaf).
- The template that project setup installs is distribution's, not this leaf's.

### Current values

- The managed part has four sections in this order: module index, commands, governance pointer, spec-discovery pointer (context-flow.ts:140-143, 310-317).
- AI is on for a person at the command line and off for agents (CLAUDECODE=1, CI=true, LORE_AI_DEFAULT=off), overridable per call (context.ts:122-131, 415-416).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The warning on a placeholder says "no usable AI provider" even when the caller switched AI off on purpose. Should it say why? | unconfirmed | product |
| Q2 | Before refusing an existing file, create resolves the narrative, so with AI on an AI call is made and thrown away (BR-876). | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-873 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-874 | unconfirmed | established | Should refreshing the user's own rules files need a project at all? |
| BR-875 | unconfirmed | established | Should the warning distinguish 'AI switched off' from 'AI failed'? |
| BR-876 | unconfirmed | established | Should the existence check run before any AI call? Partly pinned: AC-CTX-8 of `spec-context-verb-family-two-zone-claude-md-anatomy-lore` — context-flow.test.ts 'refuses to re-init when CLAUDE.md already exists' pins the refusal, not exit 4. |
| BR-877 | unconfirmed | established | Should a forced create be gated by the same size check as refresh? Partly pinned: AC-CTX-8 of `spec-context-verb-family-two-zone-claude-md-anatomy-lore` — context-flow.test.ts '--force re-init preserves the existing file's bytes as Z2' pins the content, not exit 0. |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-872. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
