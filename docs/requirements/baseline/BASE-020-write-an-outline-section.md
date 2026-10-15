---
id: BASE-020
type: baseline
role: intent
title: "Write an outline section"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-081
---
## Write an outline section

> The requirements document's structured outline is read-only: its sections can be listed, and every action that used to write, remove or exempt is refused and points to the baseline tree that replaces the outline.

Scope: the outline command family. Since the baseline tree replaced the outline, this leaf records two things: the listing that still works, and the refusal of every retired write.

### Behaviour

**Command.** Someone names the requirements document and asks for its outline sections; or tries one of the retired actions: writing a section, removing one, or exempting a plan from the outline-sync check.

**Constraint.** Listing needs a requirements document (BR-696). Every retired action is refused with outcome code 4, names the baseline action that replaces it, and writes nothing (BR-985). A general document edit cannot change the outline either (BR-695).

**Event.** None. Listing writes nothing and leaves the document's version unchanged (BR-694); a refused action records nothing.

### Terms used here

- **Outline section**: defined in the branch glossary.

### Boundary notes

- The exemption from the outline-sync check belonged to execution ("Close a plan"). Its writer was retired with the other outline writes, and the refusal is recorded here (BR-985) because the retired action is still invoked through the outline command family; plan closing now reads the state of cited rules instead (BR-984, execution).
- Whether stored sections' links resolve, and the size budget of the projected document, are reported by the status report (**hygiene**).
- The knowledge an outline section used to hold is now written as baseline structure (**product baseline**: `lore baseline add` and its rule and glossary actions).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Outline actions still accepted | listing only | product code | 2026-10-10 |

### Depends on

- corpus (not yet written): the requirements document.
- product baseline: `lore baseline add`, the action every refusal names.

### Open questions

None.

#### Rules held below established

Each rule below matches the code as read on 2026-10-10, but no live check-decided criterion would fail if it were false. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). Every live rule of this leaf held below established is listed here.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-694 | unconfirmed | established | No question about intent: its citing criterion (AC-080-2) still states the retired write; a criterion stating the read-only listing would establish it. |
| BR-696 | unconfirmed | established | No question about intent: waiting for a check-decided criterion that fails if this is false. |
| BR-985 | unconfirmed | established | No question about intent: its citing criterion (AC-BLS3-6) has attested passes; the confidence is not raised by a prose fix. |
