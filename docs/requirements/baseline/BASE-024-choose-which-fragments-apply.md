---
id: BASE-024
type: baseline
role: intent
title: "Choose which fragments apply"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-15
tags: []
parent: BASE-139
---
## Choose which fragments apply

> Lore decides, with one choice shared by every verb, which context fragments reach the project's rules files, the user's rules files, on-demand skills and a starting helper agent. Since 2026-10-15 no fragment is injected into a starting main session.

### Behaviour

**Command.** Implicit in refresh, check and render: the fragments of the three places are read, validated and chosen for one target. Explicit since `spec-rule-store-git-tracked-fragment-selection-on-demand-skill`: `lore context list` prints every fragment with its place, delivery, size and whether it is chosen; `lore context remove <name>` adds a name to the owning scope's disable list and `lore context add <name>` takes it out, each then refreshing (BR-1063).

**Constraint.** Every fragment file must be valid; a name may appear once per place. A fragment in a higher place replaces a lower one of the same name (BR-899), but a static main-session fragment may be replaced or disabled only from the place that owns the next layer up (BR-905). Refresh and check refuse an illegal override and name it; the helper-start injection does not check for it and injects a replacing helper fragment (BR-911, injection leaf, Q1). Every fragment is chosen unless its name is in the disable list of the selection that owns it: the project's selection is a file kept with the project's fragments and shared through version control, so every teammate renders the same project rules, and the user's selection sits with the user's fragments; for helper starts both lists apply (BR-1060). A disable list written in lore's settings files instead is refused by refresh, check and the selection verbs, naming the selection file to move it to (BR-1062). Static main-session fragments go to rules files unless marked for on-demand delivery, which become a skill and never reach a rules file or any start injection; a dynamic main-session fragment is refused by the context check (its session-start target is retired, BR-1066); helper fragments go to that helper's start, and one for a helper type never reaches another (BR-1061). A shipped rule whose violation a checkpoint already refuses is delivered in the skill or agent definition of the activity it governs, not in an always-loaded rules fragment; a rule no checkpoint enforces stays always-loaded (BR-1094). The project's and user's rules files draw on separate inputs (BR-902), and language decides the rest (BR-904). `context remove` and `context add` are idempotent; an unknown name, or a static main-session fragment the scope does not own, is refused with exit 4, and a concurrent change to the selection file exits 5 writing nothing (BR-1063).

**Event.** Choosing raises none of its own: the choice feeds the verbs of the sibling leaves. `context remove` and `context add` change the owning scope's selection file and then refresh the rules files; no corpus document or audit entry is written.

### Terms used here

- **Context fragment**, **fragment place**, **static** and **dynamic fragment**, **audience**: branch glossary.

### Boundary notes

- What a verb does with an invalid set differs: refresh and check fail, the start injection carries a notice (sibling leaves).
- Shipped fragments are installed by distribution.
- The `context list`, `remove` and `add` verbs (BR-1063) are held here because they edit the selection this leaf defines. The context branch's boundary names only the context create and refresh verbs and the fragments command; adding these verbs to it is a change to the parent, not to this leaf.
- BR-1094 is held here because it decides which delivery a shipped rule's fragment gets (always-loaded rules file or on-demand skill or agent definition), the same choice BR-1061 makes for every fragment. Writing the shipped skill and agent files is distribution's; it landed with `spec-always-loaded-rules-keep-only-what-no-checkpoint-enforces` under `adr-rule-delivery-tiers-gate-hook-skill-and-optimistic`.
- What happens to a dynamic main-session fragment after the session-start target's retirement is reported by the context check ("Check the context setup", BR-1066); the retirement itself is "Inject context at start". The context branch's diagram and glossary still describe dynamic fragments as injected at session start; that is a change to the parent, not to this leaf.

### Current values

- Places: shipped <lore assets>/context, user <user config folder>/context, project <project>/.lore/context; only *.md files directly in each folder (discover.ts). The user config folder is `LORE_CONFIG_HOME`, else `XDG_CONFIG_HOME/lore`, else `~/.config/lore` (user-config-dir.ts).
- Selection files: project `.lore/context/selection.yaml` (tracked in version control); user `<user config folder>/context/selection.yaml` (selection.ts:27-28).
- Delivery of a fragment: `rules` by default, or `skill` (on-demand; needs a description, static mode and the main audience) (core context-fragments.ts:63-76).
- Language of a session or helper start: the project's if set, else the user's (core context-fragments.ts:121-125).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A helper fragment that reuses the name of a static main-session fragment its place does not own is an illegal override (BR-905). Refresh and check refuse it; the helper-start injection injects it (BR-911). Should the helper-start injection refuse it too, or is the override rule meant for rules files only? | undecided | product |
| Q2 | Should BR-1061 drop its dynamic clause now that the session-start target is retired? | answered 2026-10-15: BR-1061 restated — a dynamic main-session fragment is refused by check (BR-1066); BR-1060 and BR-1067 likewise no longer name the session start | engineering |
| Q3 | BR-1062 names no exit code for a disable list written in settings (the context check reports it with exit 4, BR-1066). Should BR-1062 state the exit code of each refusing verb? | undecided | engineering |
