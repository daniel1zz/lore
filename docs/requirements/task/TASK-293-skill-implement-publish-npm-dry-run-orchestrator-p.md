---
id: TASK-293
type: task
role: plan
title: "[Skill:implement] publish-npm dry-run orchestrator + Publisher port"
status: archived
priority: critical
phase: "Phase 2: Publish pipeline + install simulation"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
links:
  - {id: TASK-292, type: blocks}
---
Estimate: L
Approach: New repo-side orchestrator `scripts/publish-npm.ts` (never shipped). Thin sequencing:
(a) invoke existing `bun run build` (current platform, unchanged contract); (b) assemble
`dist-npm/<pkg>-<target>/` from `buildPublishPlan` (T2) using platform-map (T1) — write binary
+ assets tree + postinstall (T3) + generated manifest, `chmod +x` binary; (c) verify: staged
binary `--version` smoke, `lore setup --dry-run --claude-dir <tmp>` against STAGED assets,
`npm pack --dry-run` file-list check, `tar -tvf` mode assertion (dist/lore executable), tarball
size <150MB tripwire; (d) `npm publish` ONLY under `--publish`. npm invocation goes through an
injected `Publisher` port `{npmPack, npmPublish}` — real impl = node:child_process (MIRROR
`packages/lore/src/adapters/real-mcp-registrar.ts`: node:child_process NOT Bun.spawn, never
throws, argv from a pure builder), fake in tests. Flags: `--publish`, `--tag <dist-tag>`,
`--registry <url>`, `--pack-only`. BARE INVOCATION IS DRY-RUN (INV-1, D9). Decision logic
(flag parsing, stage selection) in pure helper(s) so it is unit-testable with a fake Publisher.
Source: SPEC-048 Scope IN #2, Design pipeline-stages a-d + D2/D9; port pattern real-mcp-registrar.ts.
Dimensions: D-FUNC, D-CODE
Scope-Alt: `--registry`/`--tag` handling may be minimal pass-through; the dry-run-default gate and stages a-c are not negotiable. If landing as one worktree unit proves hard, the stage a-b (build+stage) vs stage c-d (verify+publish-gate) seam is a viable future split point (per reviewer note).
Covers: AC-048-A (orchestration unit test), AC-048-B (bare dry-run pipeline)
Blocked by: T2 (buildPublishPlan — runtime call), T3 (postinstall.mjs must exist to stage); T1 covered transitively via T2 (platform-map os/cpu).

AC:
- D-FUNC (INV-1): Given a fake Publisher and a BARE run (no --publish), also `--pack-only` and
  `--tag beta` runs,
  When the orchestrator's pure flag→stage logic executes,
  Then `fakePublisher.npmPublish` is NEVER called; only stages a-c (and npmPack under --pack-only) run.
- D-FUNC: Given `--publish` present,
  When the pipeline reaches stage d,
  Then `fakePublisher.npmPublish` is called exactly once with the resolved `--tag`/`--registry`.
- Integration (AC-048-B): Given this machine after T1-T3 land,
  When `bun run scripts/publish-npm.ts` runs (bare, dry-run) end-to-end,
  Then stages a-c pass: staged binary `--version` prints a version, `lore setup --dry-run
  --claude-dir <tmp>` RESOLVES the staged assets (exit 0), `npm pack --dry-run` file list matches
  the `files` allowlist exactly, `tar -tvf` shows `dist/lore` with an executable mode bit, and the
  computed tarball size is <150MB — process exits 0 with NO publish performed.
- Oracle A: `bunx vitest run packages/lore/tests/unit/distribution/publish-pipeline.test.ts` GREEN.
- Oracle B: `bun run scripts/publish-npm.ts` exit 0 (attested via `lore verify`).
