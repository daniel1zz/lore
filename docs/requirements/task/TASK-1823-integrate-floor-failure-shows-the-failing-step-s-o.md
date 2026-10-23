---
id: TASK-1823
type: task
role: plan
title: "Integrate floor failure shows the failing step's own output, and the coverage floor script renders only what the CLI decided"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Found 2026-10-19 landing worktree-agent-a1b8e7bd9e3a1a91c: the integrate floor refused at `check:baseline-coverage` (exit 1) but the integrate output named NO unaccounted pair — only "FAIL exit 1 bun run check:baseline-coverage". The refusal was not self-sufficient; reproducing it took a hand-built worktree + corpus snapshot.

Two causes:
1. Truncation: integrate keeps only a 4000-char tail of the floor output (packages/lore/src/service/integrate-service.ts ~76/264; adapters/cli/commands/integrate.ts spawnSync). run-chain (scripts/run-chain.ts) prints each step's output in step order, so a failing early step's lines (baseline-coverage is step 5 of 16) are pushed out of the tail by later steps.
2. Re-derived verdict text: scripts/check-baseline-coverage.ts renderMissing (~line 87) prints `unmeasured <leaf>: no command declared` for any leaf with zero commands, re-deriving a verdict the CLI already made — after BL-D1 a command-less cross-cutting leaf is measured by owned sites (measured_by owned_sites, ok true), so the line is false. It also omits the CLI's absent_commands and per-leaf fix_commands.

End state: (1) the floor's failure output always ends with each FAILED step's own output (run-chain re-prints failed steps' captured output after the exit table, bounded per step with an explicit "... N lines omitted" marker, never silent truncation), so the integrate tail carries what to fix; integrate's stored tail is sized to keep that block. (2) the coverage floor script renders only what the CLI's --json states (per-leaf `fix_commands`, `absent_commands` as informational, `measured_by`), with no verdict logic of its own.

AC: red-first — (a) a run-chain test where step 2 of 4 fails with a 200-line output and steps 3-4 print 10 KB each: the final 4000 chars contain step 2's failure lines; falsifier: today's tail. (b) renderMissing on a CLI payload with a command-less leaf measured_by owned_sites, ok true, prints nothing for it; falsifier: today's "unmeasured" line.
