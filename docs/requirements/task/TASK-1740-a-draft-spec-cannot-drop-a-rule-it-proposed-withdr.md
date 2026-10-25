---
id: TASK-1740
type: task
role: plan
title: "A draft spec cannot drop a rule it proposed: withdraw refuses a proposed add and only deprecating the whole spec releases it"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-19 while drafting spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end. 'lore rule propose <spec> withdraw BR-1348' on a DRAFT spec refused: 'BR-1348 is a proposed add; its reserved id is released by deprecating the spec, not by a withdraw'. A review then found the proposed rule wrong, and the only exits were to deprecate the whole spec or to reuse the reserved id for a different rule through 'amend' (what was done here). The second keeps the reserved-id history pointing at an unrelated earlier statement. End state to design: while the spec is a draft and no criterion cites the id, a proposed add can be withdrawn and its reservation released (or recorded as never-live), so a change set is editable like the rest of a draft.

Second instance, same day: spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end, approved, needed a substantive change (clause 2) before its integrate task was dispatched. Every route was closed:
- 'lore reopen' refused because a sibling task had already recorded red evidence.
- A superseding spec could not cite the old spec's proposed rule ids (AC_CITE_REQUIRED: not a rule any leaf lists).
- The old spec's proposed adds could not be withdrawn, so they would still go live with the wrong text.
The change went through 'lore set --correction', whose help says it is for typo-level fixes. End state to design: a spec change set and its criteria can be revised substantively while no implementation of the affected criteria has landed, without misusing the typo-level correction path.
