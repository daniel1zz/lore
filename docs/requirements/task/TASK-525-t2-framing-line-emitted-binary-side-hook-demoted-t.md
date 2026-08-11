---
id: TASK-525
type: task
role: plan
title: "T2 framing line emitted binary-side, hook demoted to verbatim relay"
status: archived
priority: medium
phase: "P2 surfaces"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-101
plan: PLAN-101
links:
  - {id: TASK-523, type: blocks}
---
lore bootstrap --injection prints BOOTSTRAP_FRAMING_LINE itself. Phase E of the hook stops authoring prose about the payload: delete the hard-coded "## Lore Bootstrap (hook-injected)" header and the "Corpus pointer set ..." sentence, keeping the blind-pipe contract (fence-wrap + inject, zero field knowledge) and the fail-open contract byte-for-byte. Both retired strings must have zero hits in the hook source afterwards. Satisfies the implementation half of AC-CP-3.
