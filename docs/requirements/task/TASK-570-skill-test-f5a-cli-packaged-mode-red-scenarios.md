---
id: TASK-570
type: task
role: plan
title: "[Skill:test] F5a CLI packaged-mode RED scenarios"
status: archived
priority: high
phase: "Phase 3: CLI & delivery"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-581, type: blocks}
---
Estimate: S
Source: AC of the paired impl task (CLI default flip), spec DD-5, AC-F5A-5
TDD-Role: red | Paired-Impl: CLI packaged-mode default flip
Dimensions: D-FUNC

Scenarios (packages/lore/tests/integration/dashboard-command.bun.test.ts, spawn the CLI from source):
- source-run guard: Given a source run with no built dashboard assets, When `lore dashboard --no-open` executes in packaged mode, Then exit code != 0 and stderr names BOTH `bun run build` and `--dev`; no vite process is spawned; no silent fallback.
- handshake: Given assets available (fixture manifest seam or built), When `lore dashboard --no-open` starts, Then stdout emits a parseable handshake line containing the nonce URL (machine-readable marker) before blocking.
- dev retention: Given `--dev`, When the command parses flags, Then the vite child path is selected and --dashboard-port is threaded into the computed allowlist (assert via debug/log seam, no hardcoded 5173 literal consulted).

AC:
- All scenarios exist as executable tests; exit codes measured directly (cmd > out 2>&1; echo $?), never through a pipe.
- Run tests → all RED; failure reason is "missing implementation", not a test bug.
