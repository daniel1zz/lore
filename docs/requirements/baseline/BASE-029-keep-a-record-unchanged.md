---
id: BASE-029
type: baseline
role: intent
title: "Keep a record unchanged"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: BASE-066
---
## Keep a record unchanged

> Every document is either living — it describes how things are now and is changed in place — or a record of something that happened, which is never rewritten once settled; a change of behaviour is a new record, not an edit.

Scope: which document kinds are living and which are records, the moment a record becomes locked, what a body or title change to a locked record does, the audited amendment and reopen exits, and how a record shows what later changed it. Creating the replacing record follows "Create a document"; retiring a knowledge or decision record follows "Supersede a document" and "Invalidate a document".

### Behaviour

**Command.** An author edits a document's body or title (the generic edit, "Revise a document"), restores an earlier version, or edits a specification's criteria.

**Constraint.** Baseline nodes, the requirements document, reference, skill and prompt knowledge, and a plan that is not closed are living: edits behave as "Revise a document" says. Specifications, decision records, tasks, phases of a closed plan, closed plans, and ideation, retro, research, assessment, handoff and acceptance knowledge are records. A record locks when it is settled: a specification, decision record or knowledge record once approved; a task once claimed; a plan and its phases once closed. A body or title change, a restore, or a criterion change on a locked record is refused and names the way to make the change (a new specification related to the old one, a successor through supersede or invalidate, reopening an approved specification without evidence, or a correction). Two exits stay open: a small correction given with a reason, recorded and shown — to the body, the title, or one existing criterion of a specification; and reopening an approved specification that no criterion has evidence for yet.

**Event.** A refusal writes nothing. An accepted correction writes one version and one audit entry carrying the reason. A reopen writes one status change with its reason.

### Terms used here

- **Living document**: a document that states the current form of something and is edited in place; its history is in its versions, never in its text.
- **Record**: a document that states what was decided, specified, planned, done or learned at a point in time.
- **Locked**: a record past the moment it was settled; its body, title and (for a specification) criteria no longer change except by a recorded correction.
- **Correction**: a small change to a locked record given with a reason, such as a typo or a factual error about what happened.

### Boundary notes

- Actions with their own command (criteria citations, links, claims, evidence, phase structure of an open plan, anchors, invalidation, archiving, rule edits) are not edits of the body and are not refused here; the specification criteria actions other than citing are, except that one existing criterion may be fixed as a correction with a reason (BR-1069); adding or removing a criterion is never a correction.
- Priority, tags and name stay editable on a locked record ("Revise a document", BR-722).
- What replaces a record is shown on the old record from its links, never by editing it.
- A plan's openness is execution's: a plan is closed once archived or deprecated.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether locked records are refused | on | project settings maintainer | 2026-10-11 |

### Depends on

- corpus, "Revise a document": the generic edit this leaf restricts.
- corpus, "Supersede a document": retiring a knowledge or decision record.
- execution: what claimed and closed mean.
- review: what approved means.

### Open questions

None.
