---
id: PLAN-188
type: plan
role: plan
title: "Session trail: record what each run changed, judge it at turn end, carry it in the handoff"
status: draft
priority: high
created: 2026-10-16
updated: 2026-10-16
tags: [session, turn-end, handoff]
parent: SPEC-190
phases:
  - {name: "foundation", description: "Trail schema, readers (hook + core), writers for session start, helper start and edits, retention"}
  - {name: "measurement", description: "Helper measurement at SubagentStop; change-source attribution and the source-edit finding at turn end"}
  - {name: "consumers", description: "lore session trail, lore run tasks, trail-review (helper scope, co-change, judged ends), handoff fill"}
  - {name: "landing", description: "Hook roster + manifest, rule apply, leaf prose, anchors, verify, full suite, build, latency record"}
---
# Plan: Session trail — a session-local record of what each run changed

Implements its parent spec, the session trail spec (AC-ST-1..12; its rule change set adds the session-trail rules and modifies BR-1087, BR-1089, BR-333 and BR-343 — `lore rule changes <spec>`).

## Risk Register
- R1 (H): vcs attribution misreads git history (rebase, cherry-pick, conflicted merges) and either hides main-session edits or floods findings. Mitigation: `attributeTurn` is a pure function with ≥10 fixture cases (AC-ST-3) including own-commit and conflict cases; edit records always win. Contingency: a reflog action the function does not recognise yields `unknown`, never `vcs`.
- R2 (M): Stop latency grows (temporary-index snapshot is 393-819 ms on this repo). Mitigation: seed the temporary index from the real index; spawn `trail-review` only when needed (AC-ST-10); landing task records p50 of 20 Stop runs, target ≤ 150 ms added. Trigger > 300 ms → open a follow-up issue before closing the plan.
- R3 (M): a helper's SubagentStop fires more than once (commit guard exit 2) or races with `run-end` releasing claims. Mitigation: helper record overwritten per firing (AC-ST-2); `lore run tasks` reads audit claim rows that survive release (AC-ST-8).
- R4 (M): shared files across tasks (`assets/hooks/lib/session-trail.mjs`, `assets/hooks/stop-turn-review.mjs`, `packages/lore/src/adapters/cli/commands/session.ts`, roster + manifest). Mitigation: `blocks` links serialise every pair sharing a file; roster registration lives only in the distribution task.
- R5 (M): rule-change landing leaves leaf prose contradicting the new rules (issue #212). Mitigation: the landing task rewrites the prose of every touched leaf ("Check a turn at its end" Event and terms, "Hand off a session", "Attribute work to a run", "Install the agent integration", the Session branch cross-cutting paragraph) in the same pass as `lore rule apply`.
- R6 (L): this repo's `.lore/config.yaml` co-change rule fires on legitimate turns. Mitigation: the rule covers only assets → manifest; measured over the landing session's own turns.

## Invariants
- I1: No test or smoke run writes this repo's `.lore/` or the real `~/.claude`: every trail test uses `CLAUDE_STATE_BASE_OVERRIDE` + `mkdtemp`, every corpus test `mkdtemp` + `lore init`.
- I2: Every change ships through a distribution surface (assets/ SSOT + regenerated `packages/lore/src/generated/assets-manifest.ts`, or binary code), never only this machine's `~/.claude`.
- I3: Red first, recorded by the implementer who ran it: `lore evidence <task> --result expected-fail --output-tail-file <log>` before the green run.
- I4: Worktree oracles are scoped (`bun run test:changed <base>` + the task's AC test files + `bun run typecheck`); the full suite runs once on main after merge.
- I5: No new hook refuses a tool call or blocks; only `stop-turn-review.mjs` blocks, and only a turn's end (BR-1087, BR-1092). Every new hook exits 0 with empty stdout on every path.
- I6: `@lore/core`'s default barrel imports no Node builtin: fs reading of the trail lives in `session-trail-node.ts`, exported from `src/node.ts` only.
- I7: Unmeasured is never rendered as empty anywhere (hook, CLI, handoff).

## Decisions Log
- D1 (2026-10-16): No [Skill:test]-blocks-[Skill:implement] TDD pairs (issue #23: unsatisfiable under lore done's floors; same as plan-interception D1). Each implementer writes the failing test, records expected-fail, then implements to green. Rejected: TDD-pair injection (deadlock), test-after (no red evidence).
- D2: Vertical slices per AC group, serialised only where tasks share a file (R4). Rejected: horizontal (all hooks, then all CLI) — false serial edges.
- D3: The spec was rebuilt three times during S2/S3 (soft-deleted drafts with slug suffixes none, -2 and -3, and the first plan with its tasks) because a proposed rule cannot be corrected in place (issue #198); the rule ids those drafts reserved were released with them.

## Exit Criteria
- Every task archived via `lore done` after merge; `lore rule apply` lands the whole change set; `lore verify <plan>` attests every script AC; full suite (`bun run test:vitest`, `bun run test:bun`) and `bun run typecheck` green on main; `bun run build` after the last merge; Stop latency recorded with and without the trail-review spawn (R2); `lore assess <plan>` triaged.
