---
id: KN-140
type: knowledge
role: knowledge
title: "Full-suite oracle contention + orphaned-browser CPU noise — misattribution corrected, scoped-oracle dispatch mechanized"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: KN-141, type: relates-to}
  - {id: SPEC-070, type: informs}
---
# Full-suite oracle contention + orphaned-browser CPU noise — misattribution corrected (2026-07-23)

## Incident

During the wave-1 parallel dispatch of SPEC-065/066/067 (three worktree implementers
on one 8-core machine), full-suite verification runs degraded into 30s-timeout
cascades: load average peaked at 150+, `bun run test:vitest` runs took tens of
minutes, and two agents reported 70+ test failures each — ALL carrying the literal
`Test timed out in 30000ms` signature in subsystems unrelated to their diffs.
Both agents independently proved non-causation (065 via stash-falsification: the
pre-diff baseline failed identically; 066 via grep: no failing file references its
anchors). Two harness API interruptions and a host-session restart compounded the
wall-clock loss to ~1.5h.

## Root cause — TWO stacked factors, initially misattributed to one

1. **Background CPU noise (the dominant baseline, found by the human operator):**
   three never-closed `agent-browser` sessions from the previous day's guyin
   dogfood/UAT (`guyin-repro`/`guyin-uat`/`guyin-diag`) plus one 5-day-old
   automation Chrome whose children had gone `<defunct>` (hung parent, never
   reaping). The live headless instances run with `--enable-unsafe-swiftshader` —
   software rendering, so "GPU" work burns CPU continuously. Baseline load ~40
   before any tests ran.
2. **N× concurrent full-suite runs (the self-inflicted increment):** each dispatch
   bundle told its implementer to finish with `bun run test:vitest + test:bun`
   (262 + 71 files). Many "unit" tests spawn real subprocesses (`dist/lore`
   binary, git, node hooks) under a fixed 30s timeout; 3-4 concurrent suites on
   top of the browser noise starved those spawns → timeout → agents re-ran to
   diagnose → more load. Positive feedback loop to load 150.

Diagnostic notes worth keeping:
- `<defunct>` zombies consume NO CPU — `ps` %CPU readings on them are stale
  artifacts. Zombies are a SYMPTOM (hung parent), never the load source.
- An agent's stash-falsification proves "not my diff" but CANNOT distinguish
  which load source causes the timeouts — orchestrator-level attribution needs
  `ps`/`uptime` forensics, which happened only after the operator pushed back.

## Mechanized fixes (landed this session)

1. `assets/agents/lore-implementer.md` (+ installed copy, parity verified):
   **Oracle Scope: SCOPED, never full-suite** — AC files with `-t` matched-count
   assertion, `bunx vitest run --changed <merge-base>` (vitest ≥3 supports
   `--changed`, verified locally), anchor-matching `.bun.test.ts` files,
   `bun run typecheck`. Full suite runs ONCE on main by the orchestrator
   post-merge.
2. `assets/skills/lore-autopilot/SKILL.md` (symlink-installed): dispatch bundles
   MUST scope oracles; full suite is the orchestrator's Phase-4 step.
3. Global CLAUDE.md: one line each for the scoped-oracle split and for
   agent-browser session hygiene (`session close` at task end; leftover
   swiftshader headless Chrome burns CPU for days).

## Lessons

- **A load spike has a stack, not a cause.** The first plausible culprit (our own
  test concurrency) explained the symptom and stalled further investigation;
  the dominant baseline (orphaned browsers) surfaced only via operator pushback.
  Attribution discipline: before blaming the workload you control, snapshot
  `uptime` + top consumers — 10 seconds of `ps` beats an hour of re-running.
- **Fixed-timeout subprocess-spawning tests are load-sensitive oracles**: under
  contention they fail with a uniform timeout signature. Uniform
  `Test timed out` across unrelated subsystems ⇒ suspect the machine, not the diff.
- **Ephemeral browser sessions are resources with no GC**: every
  `agent-browser --session <name>` without a matching close is a permanent CPU
  leak (swiftshader). Session hygiene is part of task teardown, same tier as
  worktree cleanup.
