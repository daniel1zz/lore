---
id: TASK-296
type: task
role: plan
title: "[Skill:implement] platform-map SSOT extraction + build.ts parity"
status: archived
priority: critical
phase: "Phase 1: Core modules"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
links:
  - {id: TASK-294, type: blocks}
---
Estimate: S
Approach: Extract `resolveLibsqlTarget`'s platform/arch (+linux libc) branch logic from `scripts/build.ts` into a new `scripts/platform-map.ts` that exports a pure function returning a STRUCTURED object `{os, cpu, libc?, libsqlTarget}` (never a fused string). `build.ts` imports it and derives the libsql target from `.libsqlTarget` — its native-addon resolution must stay byte-identical.
Source: SPEC-048 Scope IN #1 + Design D-graph; existing logic at scripts/build.ts:26-42.
Dimensions: D-FUNC, D-CODE (SSOT extraction)
Scope-Alt: none — this is the SSOT foundation the assembler + orchestrator both consume.
Covers: AC-048-A

AC:
- D-FUNC: Given platform/arch pair (darwin/arm64, darwin/x64, linux/x64, linux/arm64, win32/x64),
  When `resolvePlatform()` (or equivalent exported fn in scripts/platform-map.ts) is called,
  Then it returns a structured `{os, cpu, libc?, libsqlTarget}` object whose `libsqlTarget`
  equals the legacy string ("darwin-arm64","darwin-x64","linux-x64-gnu","linux-arm64-gnu","win32-x64-msvc"),
  and `os`/`cpu` are the npm-canonical values (e.g. os "darwin"|"linux"|"win32", cpu "arm64"|"x64").
- D-FUNC: Given an unsupported platform/arch,
  When the function is called,
  Then it throws with a message naming the platform/arch (parity with the pre-refactor throw).
- Integration (REGRESSION): Given `scripts/build.ts` after the refactor,
  When the build's libsql target is resolved,
  Then `build.ts` obtains its target string EXCLUSIVELY from `platform-map.ts`
  (a source-scan assertion in the test reads build.ts and confirms it IMPORTS platform-map AND
  contains NO inline platform/arch switch — no `process.platform === "darwin"`-style branch and
  no local `resolveLibsqlTarget` definition), and `nativePkg` is byte-identical to the
  pre-refactor value for the current platform.
- Oracle: `bunx vitest run packages/lore/tests/unit/distribution/platform-map.test.ts` GREEN with
  six-dimension coverage — HAPPY (all 5 pairs), NEGATIVE (unsupported-throw), BOUNDARY (libc
  present only on linux), STATE (structured-shape), REGRESSION (legacy-string parity table),
  AND the explicit source-scan (build.ts imports platform-map + contains no inline switch,
  mirroring T3's zero-dep conformance-scan pattern).
