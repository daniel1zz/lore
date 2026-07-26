---
id: TASK-295
type: task
role: plan
title: "[Skill:implement] zero-dep TTY-gated postinstall.mjs + conformance"
status: archived
priority: medium
phase: "Phase 1: Core modules"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
links:
  - {id: TASK-293, type: blocks}
---
Estimate: S
Approach: New shipped file `npm-pkg/postinstall.mjs` — dependency-free (node builtins ONLY).
Export a pure `decide({isTTY, env}) → {action, message}` plus a `process.argv[1]` execution
guard so vitest can import the pure fn without running the side effect. Behavior per spec
postinstall contract: `env.CI` truthy OR `!isTTY` → `{action:"nudge-stderr", message:<one line>}`;
TTY+non-CI → `{action:"nudge-stdout", ...}`. Wrapper try/catch → `process.exit(0)` ALWAYS.
Directory `npm-pkg/` is deliberately NOT under `assets/` (INV-5). Two test files under
tests/unit/distribution/: the decide() matrix test AND a zero-dep conformance test (no
non-builtin import/require specifier anywhere in postinstall.mjs) mirroring assets-ssot.test.ts.
Source: SPEC-048 Scope IN #4, #8; Design D1 + postinstall contract; conformance pattern packages/lore/tests/unit/assets-ssot.test.ts.
Dimensions: D-FUNC, D-CODE
Scope-Alt: nudge message wording is negotiable; the action/exit-0 contract is not.
Covers: AC-048-A

AC:
- D-FUNC: Given `decide({isTTY:false, env:{}})`,
  When called,
  Then returns `{action:"nudge-stderr", message:<single line containing "lore setup">}`.
- D-FUNC: Given `decide({isTTY:true, env:{CI:"true"}})` (CI truthy wins),
  When called,
  Then action is "nudge-stderr" (CI forces non-interactive branch).
- D-FUNC: Given `decide({isTTY:true, env:{}})` (rare --foreground-scripts),
  When called,
  Then action is "nudge-stdout" with the same one-line message. Full TTY×CI 2×2 matrix asserted.
- Integration (INV-4): Given postinstall.mjs source,
  When the zero-dep conformance test scans it,
  Then it contains ZERO non-builtin import/require specifiers, contains NO reference to
  `lore setup`/`~/.claude`/`settings.json`/MCP execution, and the exec-guard wrapper is
  try/catch with `exit(0)` on every path.
- Oracle: `bunx vitest run packages/lore/tests/unit/distribution/postinstall.test.ts` (and the
  conformance test) GREEN, six-dimension coverage.
