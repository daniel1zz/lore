---
id: TASK-187
type: task
role: plan
title: "[Skill:implement] T1 embed-assets-manifest script + generated constant + build ordering"
status: archived
priority: high
phase: "Phase 1: Foundation"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-185, type: blocks}
---
Estimate: M
Approach: New scripts/embed-assets-manifest.mjs walks assets/, computes per-file sha256 + sorted-pair tree digest, writes packages/lore/src/generated/assets-manifest.ts (git-tracked) exporting EmbeddedAssetsManifest const (shape per SPEC-076 Downstream Handoff) + LORE_BINARY_VERSION from package.json. --check mode recomputes and exits 3 on mismatch, 0 on match. Wire generation BEFORE compile in scripts/build.ts (R1 mitigation). CI freshness = AC-076-9 command.
Source: SPEC-076 §C2 + Downstream Handoff EmbeddedAssetsManifest type
Dimensions: D-FUNC, D-CODE
Scope-Alt: CI wiring can land as bare npm script if build.ts splice proves risky (spawn from build.ts contingency)
Covers: AC-076-9

AC:
- Given assets/ unchanged since generation, When `bun scripts/embed-assets-manifest.mjs --check` runs, Then exit code is 0 (measured unpiped)
- Given any assets/ file edited, When --check runs, Then exit code is 3 and stderr names the regeneration command
- Given regeneration runs twice with no assets change, Then the generated file is byte-identical (deterministic: sorted walk, no timestamps)
- Given `bun run build`, Then generation executes before bun build --compile (assert ordering in build.ts) and the compiled binary's embedded tree_digest equals a fresh recomputation
- Integration: generated file exports are imported by packages/lore (typecheck green proves reachability); tsc --noEmit clean
