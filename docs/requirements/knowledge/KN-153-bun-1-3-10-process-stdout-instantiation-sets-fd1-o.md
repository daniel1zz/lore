---
id: KN-153
type: knowledge
role: knowledge
title: "Bun 1.3.10: process.stdout instantiation sets fd1 O_NONBLOCK — silent >64KB pipe truncation"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-18
tags: []
parent: PRD-001
links:
  - {id: TASK-291, type: informs}
---
## Finding (empirical, 2026-07-17)

Bun v1.3.10 (macOS arm64): the moment `process.stdout` is INSTANTIATED (any getter access), fd 1 is switched to O_NONBLOCK. From then on, when stdout is a pipe whose reader is slow (not yet reading), a single write call delivers at most the 64KB pipe buffer (65536 bytes) and the process DROPS the remainder at exit — silently, exit code 0.

## Minimal repro (deterministic, 3/3)

- Control: `bun -e 'console.log("x".repeat(135000))' | { sleep 1; cat; } | wc -c` → 135001 (console.log fast path = blocking fd write)
- Poisoned: `bun -e 'void process.stdout; console.log("x".repeat(135000))' | { sleep 1; cat; } | wc -c` → 65536
- Even one-shot `fs.writeSync(1, ...)` truncates after poisoning (single syscall on a non-blocking fd writes ≤ pipe buffer; no retry).
- `process.stdout._handle.setBlocking` does NOT exist in Bun (undefined).

## Why every lore CLI command was affected

citty (our CLI framework) imports consola; consola touches `process.stdout` at module load. So the fd is poisoned before any command runs. First real-world casualty: `lore setup --dry-run --json` (135KB) consumed via spawnSync under full-vitest-suite load → `SyntaxError: Unterminated string in JSON at position 64651` in npm-install-simulation.test.ts (AC-048-D red). Single-file test runs passed only because a fast reader drains the pipe before it fills — a timing coincidence, not correctness.

## Verified fix primitive

Looped `fs.writeSync(1, buf, off, remaining)` catching EAGAIN with a small sleep (`Bun.sleepSync(5)`) retry → full 135001 delivered. Fix wired as a composition-root chokepoint (`installSyncStdio()` replacing console.log/info/warn/error on the CLI branch only — NEVER the MCP branch, whose stdout is the protocol channel). See task-skill-implement-cli-stdout-non-blocking-truncation-fix-writ and packages/lore/src/adapters/cli/stdio-sync.ts.

## Residual risks / follow-ups

- Direct `process.stdout.write` call sites (export-docs.ts, set.ts, diff.ts) still write through the poisoned stream — small line-sized writes, but a large aggregate through a stalled pipe could still lose data at exit. Not covered by the chokepoint.
- Applies to ANY bun-compiled CLI whose dependency graph touches process.stdout (consola/citty ecosystem = very common). Check newer Bun versions for an upstream fix before assuming this is still needed on a Bun upgrade; keep the regression test (cli-stdout-truncation.test.ts) as the oracle.
- Hook consumers of `lore bootstrap --json` / `lore feed` via spawnSync are exactly the slow-reader shape that triggers this.
