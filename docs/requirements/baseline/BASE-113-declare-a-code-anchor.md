---
id: BASE-113
type: baseline
role: intent
title: "Declare a code anchor"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-10
tags: []
parent: BASE-064
---
## Declare a code anchor

> An author declares a code anchor on a spec.

This leaf also holds the two rules for removing an anchor. That bends the one-sentence test, because the sentence would need "or remove". The alternative, a two-rule "Withdraw a code anchor" leaf, was judged too small to stand alone.

### Behaviour

**Command.** After the code exists, an author adds one or more anchors to a spec (or removes them), binding the spec to the file, folder or exported name that implements it.

**Constraint.** Spec or knowledge document only; a well-formed, project-relative location; an exported name only on a file.

**Event.** `CodeAnchorDeclared` or `CodeAnchorRemoved`. The spec's status does not change.

### Terms used here

- **Folder anchor**: an anchor naming a folder rather than a file, written with a trailing slash. It cannot name an exported name.
- **Exported name**: a name the file makes available to other code, written after a hash sign. Plain English letters, digits, underscore and dollar sign, not starting with a digit. Test titles and non-Latin names cannot be anchored.

### Boundary notes

- Anchors are meant to be declared after the code lands: declaring ahead of the code produces drift at once.
- Which anchors count as drift (file or folder missing, folder empty, name missing, file-versus-folder mismatch, unreadable) is hygiene's rule.

### Current values

None.

### Depends on

- hygiene (not yet written): "drift detected" reads the declared anchors.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Anchors can be added to an archived spec, and archived specs' anchors are still checked for drift, so retired work can raise drift alarms. Should terminal specs refuse new anchors, be left out of drift checks, or both? (Related to issue 30.) | undecided | product |
| Q2 | Removing an anchor that is not there reports success, so a typo in a removal is never noticed. Should it be refused, or reported as "nothing removed"? | undecided | product |
| Q3 | An anchor cannot name a test by its title, so "which test covers this criterion" can only point at a whole test file. Is file-level anchoring enough for tracing criteria to tests? | undecided | product |
| Q4 | Nothing ties an anchor to a particular criterion; anchors belong to the spec as a whole. Is per-criterion tracing a requirement? | undecided | product |



#### Downgraded in pilot v2 — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Was | Open question |
|---|---|---|
| BR-68 | observed | Must adding or removing an anchor never change a spec's status, including an approved one? |
| BR-71 | observed | Should removing an anchor the spec does not hold leave the spec's history untouched, and should the confirmation say that nothing was removed? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-62, BR-63, BR-66, BR-69, BR-70. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?
