---
id: TASK-452
type: task
role: plan
title: "T3 — compiled consumer-path oracle"
status: archived
priority: medium
phase: "oracles"
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-086
plan: PLAN-086
---
# T3 — compiled consumer-path oracle (AC-RCH-7)

## Task Objective

Prove the fix reaches an actual consumer, not just the in-process verb: the freshly compiled `dist/lore` binary driven through the REAL unmodified Stop hook.

## Spec Reference

`spec-resume-ticket-coverage-floor-blocking-channel-arming`, AC-RCH-7. The spec's delivery claim is that a consumer who ran `lore init` + `lore setup` at any earlier version gets this fix by upgrading the binary alone — no hook reinstall, no assets-manifest regeneration. This task is the oracle for that claim.

## What the oracle must establish

Run `assets/hooks/stop-handoff-coverage.mjs` as a real child process with a `PATH` that resolves `lore` to the freshly built `dist/lore`, feeding it a Stop payload on stdin:

- **Incomplete accounting** → hook exits 0, its stdout parses as a JSON block decision naming the missing ids.
- **Complete accounting** → hook exits 0 with EMPTY stdout.

Both halves are required: without the second, the first could pass from a hook that blocks unconditionally.

## Non-negotiables

- **Build first.** `bun run build` before the assertions. This file spawns the compiled binary, and a stale `dist/lore` is a catalogued false-oracle vector in this repo — the test would measure the previous release.
- **`.bun.test.ts` naming.** This file runs under `bun test` only (it spawns processes and touches the compiled binary); it must NOT be picked up by vitest.
- **Throwaway corpus if any corpus is needed.** Never write to the repo's own `.lore/`. The verb reads only stdin and the transcript path, so a corpus should not be required at all — if you find yourself needing one, `mkdtemp` + `lore init` with cwd inside it.
- **`spawnSync` with an explicit `maxBuffer`.** The 1 MiB default silently truncates, and never discard stderr.

## File Anchors

`packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts` only. Do not touch the verb source or the unit test file.

## Oracle

`bun install` FIRST in the worktree, then `bun run build && cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts`. Assert the matched file count in the output.
