---
id: BASE-024
type: baseline
role: intent
title: "Choose which fragments apply"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-139
---
## Choose which fragments apply

> Lore decides, with one choice shared by every verb, which context fragments reach the project's rules files, the user's rules files, a starting session and a starting helper agent.

### Behaviour

**Command.** Implicit in refresh, check and render: the fragments of the three places are read, validated and chosen for one target.

**Constraint.** Every fragment file must be valid; a name may appear once per place. A fragment in a higher place replaces a lower one of the same name (BR-899), but a static main-session fragment may be replaced or disabled only from the place that owns the next layer up (BR-905). Refresh and check refuse an illegal override and name it; the start injection does not check for it and injects the replacing fragment when it is dynamic or for a helper (BR-911, injection leaf, Q1). Audience, mode, disable lists and language decide the rest (BR-901 to BR-904).

**Event.** None of its own: the choice feeds the verbs of the sibling leaves.

### Terms used here

- **Context fragment**, **fragment place**, **static** and **dynamic fragment**, **audience**: branch glossary.

### Boundary notes

- What a verb does with an invalid set differs: refresh and check fail, the start injection carries a notice (sibling leaves).
- Shipped fragments are installed by distribution.

### Current values

- Places: shipped <lore assets>/context, user <settings folder>/lore/context, project <project>/.lore/context; only *.md files directly in each folder (discover.ts:103-105).
- Language of a session or helper start: the project's if set, else the user's (core context-fragments.ts:121-125).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A dynamic or helper fragment that reuses the name of a static main-session fragment its place does not own is an illegal override (BR-905). Refresh and check refuse it; the start injection injects it (BR-911). Should the start injection refuse it too, or is the override rule meant for rules files only? | undecided | product |
