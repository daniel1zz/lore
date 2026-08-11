---
id: PLAN-101
type: plan
role: plan
title: "Implementation — context provenance (scope-declaring injection + scope-closing resume ticket)"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: SPEC-110
phases:
  - {name: "P1 core constants"}
  - {name: "P2 surfaces"}
  - {name: "P3 governance and distribution"}
---
## Goal

Land the seven ACs of `spec-context-provenance-injected-corpus-global-state-and-a`: both context sources that reach an AI at session start — the hook-injected corpus-global snapshot and a pasted resume ticket — declare their own scope, binary-side, so a fresh `lore init` + `lore setup` consumer cannot reproduce the 2026-07-30 cross-session trespass.

## Phases

**P1 — core constants + projection.** The five exported constants and the injection payload's leading scope field, including the pinned degenerate (declaration-alone-over-budget) behaviour. Everything downstream asserts identity against these constants, so nothing else can start until they exist.

**P2 — surfaces.** The two emitting surfaces: `lore bootstrap --injection` (framing line binary-side; hook demoted to verbatim relay) and `lore feed session-resume` (scope closure on CLI stdout AND the MCP `lore_feed` response). Independent file sets — these run concurrently.

**P3 — governance prose + distribution proof.** The payload-wide FEED rule, the manifest regeneration, and the compiled e2e suite that proves every surface from a throwaway out-of-tree corpus and a throwaway install dir.

## Sequencing

P1 blocks all of P2 and P3. Within P2 the two tasks touch disjoint files and may be claimed concurrently. The e2e suite in P3 asserts against all four preceding tasks' output and is therefore last.

## Verification

Per-task oracles are the spec's registered ACs (`lore verify` runs them attested). The final integration run happens on a clean tree at a named commit — a dirty concurrent checkout has been measured to turn other sessions' in-flight edits into phantom regressions.

## Acceptance Criteria

Inherited verbatim from the governing spec (AC-CP-1 … AC-CP-7); this plan declares no criteria of its own.
