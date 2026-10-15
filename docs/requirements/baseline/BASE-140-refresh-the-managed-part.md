---
id: BASE-140
type: baseline
role: intent
title: "Refresh the managed part"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-139
---
## Refresh the managed part

> A person or agent brings the managed part of the project memory file up to date with the project as it is, without touching anything written by hand.

### Behaviour

**Command.** Someone asks to refresh (`context refresh`, project scope by default).

**Constraint.** The memory file must exist (BR-885). A managed part with a start marker but no end marker, or with a damaged fingerprint line, is refused (BR-886); a file with no managed part yet, or an older managed part with no fingerprint at all, is accepted and brought up to date (BR-880, BR-881). Hand-edited sections are kept. The refreshed file must pass the memory-file limits (and, under enforce, the required sections) before it is written (BR-887). Just before the first write, refresh re-reads every file it will change and stops if any changed since it read them; a narrow gap remains between that re-read and each write (BR-888). AI is never used.

**Event.** `ManagedPartRefreshed` (files on disk; nothing in the corpus).

### Terms used here

- **Managed part**, **managed section**, **fingerprint**, **adoption mode**: branch glossary.

### Boundary notes

- The same refresh also writes the lore rules files; that half is the rules-file leaf. Since decision D16 (spec `spec-context-fragments-config-driven-layered-rule-injection`) the rules files are still written when the write-time gate refuses the memory file (BR-887). When refresh refuses earlier, because the memory file is missing (BR-885) or its managed part is broken (BR-886), nothing is written, rules files included.
- Usage errors of the `context` command, refresh's included (unknown topic or scope, misplaced options, no lore project), are stated once in the create leaf (BR-872, BR-873, BR-874).
- What the limits, required sections and adoption mode are is hygiene's (leaf "Check project memory files"); this leaf only runs that check before writing.
- The force option is accepted by refresh but has no effect.

### Current values

- Module index: at most 500 entries, the limit BR-882 refers to; hidden folders and node_modules, .git, .claude, .lore, .lore-backups, dist, coverage are never listed (context-facts.ts:112-123, 281-288).
- Section text when empty: 'No nested module directories were discovered.', 'No package.json scripts were discovered.' (context-flow.ts:268-286).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A hand-written section placed inside the managed part disappears on refresh and is not reported (BR-884). | unconfirmed | engineering |
| Q2 | A broken package file reads as 'no scripts' with no warning (BR-883). | unconfirmed | engineering |
| Q3 | A hand-edited section can only return under management by deleting it; there is no command to adopt or reset it. Is that intended? | undecided | product |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-882 | unconfirmed | established | No question about intent; the limit is a deliberate safety ceiling (context-facts.ts:66-69, 123). AC-CTX-9 of `spec-context-verb-family-two-zone-claude-md-anatomy-lore` pins which folders are left out, but no criterion would fail if the entry limit were missing. Reworded on 2026-10-10 to state the limit. |
| BR-883 | unconfirmed | established | Should a malformed package file be reported instead of read as empty? |
| BR-884 | unconfirmed | established | Should an unknown section be kept and reported, or refused? |
| BR-885 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. Partly pinned: AC-CTX-8 of `spec-context-verb-family-two-zone-claude-md-anatomy-lore` — context-flow.test.ts 'fails loud when no CLAUDE.md exists yet' pins the refusal, not exit 4. |
| BR-886 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. Partly pinned: AC-CTX-1 of `spec-context-verb-family-two-zone-claude-md-anatomy-lore` — context-projection.test.ts pins the refusal of a missing end marker and a malformed fingerprint, not exit 4. |
| BR-887 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. Partly pinned: AC-CF-22 of `spec-context-fragments-config-driven-layered-rule-injection` — pins non-zero exit, unchanged memory file and written rules files; AC-CTX-8 and AC-STR-6 pin the flow-level refusal and the warn downgrade; none pins exit 4. |
| BR-888 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. Partly pinned: AC-CF-13 of `spec-context-fragments-config-driven-layered-rule-injection` — refresh-cas.test.ts pins the CONFLICT result and zero writes, not exit 5. |
| BR-889 | unconfirmed | established | Should refresh refuse options it ignores? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-881. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
