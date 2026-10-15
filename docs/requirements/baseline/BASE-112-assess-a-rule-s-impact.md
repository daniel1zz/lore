---
id: BASE-112
type: baseline
role: intent
title: "Assess a rule's impact"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Assess a rule's impact

> Before changing or retiring a rule, an author lists the criteria that cite it, the leaves that depend on it directly or indirectly, and any circular dependencies.

### Behaviour

**Command.** Someone names a rule id.

**Constraint.** Read-only; the id must be held by a live leaf (BR-681).

**Event.** None; read-only.

### Terms used here

- **Dependency**, **citing criterion**: defined in the branch glossary.

### Boundary notes

- Dependencies are declared by "Declare a leaf dependency"; citations by specification.

### Current values

None.

### Depends on

- Declare a leaf dependency.

### Open questions

None.

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (commit a248efe0), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-682 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
