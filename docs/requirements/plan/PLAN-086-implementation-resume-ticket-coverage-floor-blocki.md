---
id: PLAN-086
type: plan
role: plan
title: "Implementation — resume-ticket coverage floor: blocking channel, arming provenance, cross-turn idempotence"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-123
phases:
  - {name: "verb"}
  - {name: "oracles"}
---
# Implementation — resume-ticket coverage floor: blocking channel, arming provenance, cross-turn idempotence

## Goal

Land the eight acceptance criteria of `spec-resume-ticket-coverage-floor-blocking-channel-arming`. All behaviour changes are confined to the compiled binary; `assets/hooks/stop-handoff-coverage.mjs` is deliberately NOT edited (AC-RCH-3 pins that its unmodified relay already carries a block decision), so no assets-manifest regeneration and no consumer `lore setup` re-run are required.

## Phases

**verb** — the three behaviour changes, all inside the `coverage-check` verb plus any new exported constant it needs.

**oracles** — the independent test suites that pin the eight ACs. Written by a subagent that did not write the implementation (complexity is above the threshold at which self-written tests stop being evidence).

## Task breakdown

| task | phase | file anchors | depends on |
|---|---|---|---|
| T1 verb behaviour | verb | `packages/lore/src/adapters/cli/commands/handoff.ts`, `packages/core/src/session.ts` | — |
| T2 unit oracles (AC-RCH-1..6, 8) | oracles | `packages/lore/tests/unit/handoff-coverage-check.test.ts` | T1 |
| T3 compiled-path oracle (AC-RCH-7) | oracles | `packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts` | T1 |

Anchor sets are pairwise disjoint, so T2 and T3 may run concurrently once T1 has merged. T1 must not be split: all three behaviour changes land in one file and a split would produce guaranteed `gate:task-claim:anchor-overlap` denials.

T1 scope, in one sentence each:

- **Verdict channel (H1/H2)** — on an incomplete accounting write one JSON object `{"decision":"block","reason":<text>}` to stdout and exit 0; keep the per-id `Undispositioned resume ticket item: <id>` lines on stderr; stop setting a non-zero `exitCode` for any verdict.
- **Reason template (H3)** — compose the reason from the `@lore/core` exports `RESUME_DISPOSITION_MARKER` / `RESUME_DISPOSITION_DONE` / `RESUME_DISPOSITION_DEFERRED_PREFIX`, emitting one line per missing id that the verb's own `parseDispositionedIds` recognises as dispositioning exactly that id. No hand-typed marker literal anywhere in the verb.
- **Arming provenance (H4)** — pair each candidate `tool_result` with its originating `tool_use` by `tool_use_id`; arm only for a `lore feed session-resume` call, Bash-shaped (the lone tokens `feed` and `session-resume` both present, order-independent, non-adjacent allowed) or MCP-shaped (`lore_feed` with a `session-resume` checkpoint). Preserve the SPEC-112 D10 exemption (`RESUME_COVERAGE_FLOOR` absent → no block) unchanged.
- **Cross-turn accumulation (H5)** — satisfy expected ids from the union of dispositions in every assistant text message after the ticket AND `last_assistant_message`. Keep reading the current turn's dispositions from `last_assistant_message` only (the transcript's newest entry may be unflushed).

## Verification notes

- **Residual behavioural risk, carried deliberately.** The review judge flagged it and it is accepted: the ACs prove the block channel and the template are emitted, but no CI oracle can prove the downstream claim that this produces compliance. That claim rests on the n=1 measured control arm (doc-sync 10/10 vs this hook 0/130 in session `2f45e6d9`). The first real consumed ticket after rollout is the confirming observation — check that a `[RESUME_DISPOSITION]` line actually appears.
- **Worktree oracle scope.** Each implementer runs `bun install` first in its fresh worktree, then `bun run test:changed <base>` — never the full suite (N concurrent full runs starve spawn-based tests into false 30s-timeout regressions).
- **Main-checkout re-verification must bypass cache.** After merge, re-run with `--force`: a non-forced turbo run reads the cache the agent's own worktree populated, which is self-report dressed as an independent pass. Judge by `Cached: N cached` and by whether the printed working directory is a worktree path.
- **`dist/lore` must be rebuilt before AC-RCH-7.** Its `.bun.test.ts` spawns the compiled binary; a stale `dist/lore` is a catalogued false oracle here.
- **Full suite once, on `main`, at a clean tree.** `git status --porcelain` must be empty — a dirty concurrent checkout turns another session's in-flight edits into phantom regressions (measured: 20+ failures dirty vs 4 clean at the same commit).

## Rollout

Binary-side only. Existing consumers get the fix by upgrading `lore`; no `lore setup`, no hook reinstall, no manifest regeneration. The governance prose in `assets/governance/corpus-workflow.md` becomes accurate as written once AC-RCH-6 lands — it is not edited.
