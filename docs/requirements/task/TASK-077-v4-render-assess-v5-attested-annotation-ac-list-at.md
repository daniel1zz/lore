---
id: TASK-077
type: task
role: plan
title: "V4 render: assess v5 attested annotation + ac list attested prefix"
status: draft
priority: medium
phase: surfaces
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-019
plan: PLAN-019
links:
  - {id: TASK-076, type: blocks}
---
Objective: attested marking on the two read surfaces. ACs: AC-VRF-8 (render half), AC-VRF-9.
Work:
1. packages/lore/src/ai/assess-template.ts — AC table coverage column annotates attested counts from the extended AcCoverageFact ("2 pass (1 attested)" style, deterministic); ASSESS_PROMPT_VERSION 4→5 with header-comment rationale (precedent: v2→v3 F3 manifest note). Update the EXACTLY 3 hardcoded version-4 assertions in packages/lore/tests/unit/service/ai-provider-service-assess.test.ts (lines ~857/879/978) AND rename the test titled "ASSESS_PROMPT_VERSION is 4" to match — confirmed full blast radius, no other file hardcodes it.
2. ac list rendering (packages/lore/src/adapters/cli/commands/ac.ts) — attested-pass renders ⚑✔ prefix variant; counts line gains "(n attested)" when >0. Rendering ONLY — the attested judgment comes from computeAcCoverage facts (single derivation point, SPEC-039 D8).
3. Tests: prompt snapshot with attested/unattested mix; legacy no-structured-AC verbatim fallback REGRESSION untouched (byte-identical, v4-era snapshot content but version literal updated); ac list render unit.
Oracle: bun run typecheck + bunx vitest run (affected).
Depends: V1 merged (AcCoverageFact.attested). Runs PARALLEL to V3 — anchors disjoint: ai/assess-template.ts + ai/CLAUDE.md + assess tests + adapters/cli/commands/ac.ts. ⛔ do not touch verify.ts / mcp tools.ts / service/.
