---
id: TASK-294
type: task
role: plan
title: "[Skill:implement] buildPublishPlan pure assembler + generated manifest"
status: archived
priority: critical
phase: "Phase 1: Core modules"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
links:
  - {id: TASK-293, type: blocks}
---
Estimate: M
Approach: New pure module `packages/lore/src/distribution/assemble.ts` exporting
`buildPublishPlan({version, platform, assetFiles, binaryPath}) → PublishPlan`. `platform` is
typed by importing `PlatformInfo` (the structured `{os,cpu,libc?,libsqlTarget}`) from
`scripts/platform-map.ts` (SSOT — do NOT redefine the shape). Returns a staging file map +
a generated `package.json` object. Target-parameterized: `nameFor(target)`, staging path
`dist-npm/<pkg>-<target>/`. P2 calls it with one target; P3 loops. No filesystem IO — pure.
Source: SPEC-048 Scope IN #3, #5; Design D3/D5/D6/D7.
Dimensions: D-FUNC, D-CODE
Scope-Alt: `nameFor` may use the placeholder scoped name (literal fixed by owner at first publish) — keep the seam, don't hardcode a final name.
Covers: AC-048-A

AC:
- D-FUNC: Given `{version:"0.1.0", platform:{os:"darwin",cpu:"arm64",libsqlTarget:"darwin-arm64"}, assetFiles:[...], binaryPath:"dist/lore"}`,
  When `buildPublishPlan(...)` is called,
  Then the returned `PublishPlan.packageJson` has `bin` deep-equal `{lore:"dist/lore"}`,
  `os` deep-equal `["darwin"]`, `cpu` deep-equal `["arm64"]`, `version` === "0.1.0",
  and `files` includes exactly `dist/lore`, `assets/**` (or the enumerated asset entries),
  `postinstall.mjs`, and README (no extras), and `private` is absent/false.
- D-FUNC: Given the same input,
  When the staging map is read,
  Then it maps the binary to `<staging>/dist/lore`, every assetFile under `<staging>/assets/...`,
  the postinstall to `<staging>/postinstall.mjs`, and the staging root is
  `dist-npm/<pkg>-darwin-arm64/` (target-parameterized).
- D-FUNC (BOUNDARY): Given a linux target with libc "musl" vs "gnu",
  When buildPublishPlan runs,
  Then `os`/`cpu` remain `["linux"]`/`[<cpu>]` (single-arch pin, D4) and the package name/target
  path reflect the target — proving P3 target-param without a call-site change.
- Oracle: `bunx vitest run packages/lore/tests/unit/distribution/assemble.test.ts` GREEN,
  six-dimension (HAPPY, NEGATIVE malformed input, BOUNDARY libc/target, STATE full plan shape,
  ERROR missing required field, REGRESSION single-writer manifest field assertions).
