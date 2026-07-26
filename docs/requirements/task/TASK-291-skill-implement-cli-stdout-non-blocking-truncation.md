---
id: TASK-291
type: task
role: plan
title: "[Skill:implement] CLI stdout non-blocking truncation fix (writeSync drain chokepoint)"
status: archived
priority: medium
phase: "Phase 3: Regression & verification"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-034
plan: PLAN-034
---
## Objective
Fix the latent whole-CLI stdout truncation defect exposed by AC-048-D: once process.stdout is instantiated (consola does so at import, via citty), Bun 1.3.10 sets fd 1 to O_NONBLOCK; any single write (console.log or one-shot writeSync) then delivers at most the 64KB pipe buffer to a slow reader and the process drops the remainder at exit. lore setup --dry-run --json emits 135KB → truncated JSON under load (deterministic minimal repro: bun -e 'void process.stdout; console.log("x".repeat(135000))' | { sleep 1; cat; } | wc -c → 65536).

## Fix (verified empirically by orchestrator)
Looped fs.writeSync(1, buf, off, len) with EAGAIN catch + Bun.sleepSync(5) retry delivers the full payload. Implement writeAllSync(fd, text) in a new packages/lore/src/adapters/cli/stdio-sync.ts and wire it as a composition-root chokepoint in packages/lore/src/index.ts on the CLI branch ONLY (never the MCP branch — stdout is the MCP protocol channel): replace console.log/info/warn/error with util.format-preserving writeAllSync(1|2) implementations. Document the full empirical chain in the module doc.

## AC
- Integration oracle: a test spawning a child bun script (or the dev CLI) through a slow-reader pipe asserts full byte delivery (>64KB payload) — vitest, node:child_process, six-dimension coverage where meaningful.
- REGRESSION: lore setup --dry-run --json output parses as JSON through a slow pipe.
- bun run typecheck green; scoped vitest green.
Oracle: bunx vitest run packages/lore/tests/integration/cli-stdout-truncation.test.ts --maxWorkers=2
