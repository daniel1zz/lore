---
id: TASK-526
type: task
role: plan
title: "T4 payload-wide FEED governance rule + manifest regeneration"
status: archived
priority: medium
phase: "P3 governance and distribution"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-101
plan: PLAN-101
links:
  - {id: TASK-523, type: blocks}
---
Generalize the FEED bullet from latest_handoffs-only to payload-wide: every injected field is corpus-global, spanning all plans/actors/sessions, and is never the session worklist nor any ticket scope. State the source-labelling duty naming all three SOURCE_CATEGORY_TOKENS categories. The rule text must name every member of BOOTSTRAP_INJECTION_KNOWN_KEYS. Regenerate the embedded assets manifest so lore setup distributes the edited text. Satisfies the implementation half of AC-CP-5.
