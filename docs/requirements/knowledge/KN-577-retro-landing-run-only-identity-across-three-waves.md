---
id: KN-577
type: knowledge
role: knowledge
title: "Retro: landing run-only identity across three waves surfaced eight governance gaps"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [retro, run-identity, concurrency]
---
## Scope

Session e25636da, 2026-10-11 to 12. Two things landed:

- issues #156 and #157 (hook turn-state; double hook registration);
- `plan-run-only-write-identity-and-run-end-claim-release` (6 of 7 tasks archived; T7 probe (b) needs a human `/clear`).

Each finding below gives its root cause and the mechanism that would refuse it.

## Findings

1. **Textually clean merge, broken build (concurrency).**
   - What happened: T2 deleted `resolveActorAlias`. A concurrent session's new command `reopen.ts` (commit 9c7cb11c) imported it. Each branch was green alone; their merge on main failed `bun run build` (TS2724) until a follow-up fix landed in 9ff67b35.
   - Root cause: nothing typechecks a MERGE RESULT before it lands, and agents verify their own branch only.
   - Mechanism needed: the merge step (or pre-push) runs `bun run typecheck` on the merged tree. The orchestrator protocol should prescribe `git merge --no-commit` plus typecheck before committing the merge.
2. **Plan anchors missed a consumer.**
   - What happened: `run-identity-node.ts` (`resolveInvocationIdentity`, which read the env tier) belonged to no task. T1 left 5 red tests there, plus 6 red tests elsewhere that injected identity through LORE_ACTOR (about 90 test files reference it).
   - Root cause: anchors were chosen from the spec's prose, not from a consumer census of the symbol being removed.
   - Mechanism needed: when a spec removes a channel (env var, flag, export), plan-promote should require a census command whose hits all fall inside some task's anchors.
3. **Capability landed without wiring, again.**
   - What happened: T4's service-level `lore done` holder check by run was green, but `commands/done.ts` (owned by T2) never passed the caller's run. Only a CLI-driving test proved the wiring after a retry.
   - Root cause: splitting tasks by layer put the capability and its surface in different tasks.
   - Mechanism needed (standing lesson, still unenforced): pair each capability with a surface-driving AC in the same task.
4. **`lore done` per-anchor floor matches paths literally (#164).** An attested run of the spec's own AC command `(cd packages/lore && bun test tests/...)` did not count. A duplicate `--capture` row with the repo-root path was needed.
5. **Silent verdicts and unaddressable lifecycle.**
   - #159: approve says nothing about a reject judgment on a type outside `judgment_required_types`.
   - #160: a deprecated rule cannot name its successor.
6. **The issue-to-task path was never walked end to end.** All 146 `task-gh-*` issue tasks were still draft, and no commit referenced one. #156 and #157 are the first adopted issues archived through claim, evidence and done.
7. **Score-gated autonomy existed only as prose** (`01KX2XW42Y`), so the agent asked the user to accept an ADR the user had directed. It is now an ideation item: `knowledge-score-gated-autonomy-ai-assesses-decision-factors-the`.
8. **A worktree's `@lore/core` resolves to the main checkout.** Every implementer added untracked `node_modules/@lore/*` symlinks to test its own core changes. A red run made before the symlinks exist silently measures main's code. Known as TASK-888, and it recurred in 6 of 6 dispatches.

## What held

- The run-end hook was hot-loaded by Claude Code mid-session. A background subagent's run ended 8 s after registration (`end_reason` = subagent-stop), which settles probe (a).
- All 10 script ACs re-ran green on merged main. Full vitest stayed at its 15-failure baseline (same 7 files). Full bun showed 4 failures, all pre-existing.
