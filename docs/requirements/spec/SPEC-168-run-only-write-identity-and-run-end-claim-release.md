---
id: SPEC-168
type: spec
role: spec
title: "Run-only write identity and run-end claim release"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-17
tags: [run-identity, claims]
---
## Overview/Goal

Implement `adr-write-identity-is-the-attested-run-alone-a-run-s-claims-end`:

- The attested run is the only identity source of a write. `--by` and `$LORE_ACTOR` are retired.
- Claim ownership, archiving and overlap are decided by run.
- A run ends at SessionEnd / SubagentStop, and its clean claims are released at once.
- An `orphaned_dirty` claim protects uncommitted work until it is stolen or its working copy becomes clean.

This spec also absorbs issue #153: shipped text still tells users to export `LORE_ACTOR`.

Governing rules: BR-1055, BR-1056, BR-1057, BR-1058 and BR-1059 (new), plus BR-1029, BR-1032, BR-1039 and BR-1045. Deprecated by this spec, and retired when it lands: BR-1018, BR-1022, BR-1033.

## Scope

In scope:

1. **Identity resolution.** Delete the `$LORE_ACTOR` tier from `packages/core/src/actor-resolution-node.ts` and from the CLI copy in `packages/lore/src/adapters/cli/utils.ts`. Without a run, the order is session tier, then worktree-derived name, then OS user.
2. **`--by` removal.** Remove `--by` from every WRITE command under `packages/lore/src/adapters/cli/commands/`, and `by` from every MCP write tool schema.
   - Read-side `--by` options that filter output stay. They are kept on an explicit allowlist that a test pins.
   - lore's internal writer identities (the AI judge `ai:claude-cli:*` and `system`) are set in code, are not caller input, and stay unchanged (BR-1032).
3. **Run-decided ownership.**
   - `hasClaimConflict` (`packages/core/src/run-identity.ts`) compares derived identities only when both parties lack a run. When exactly one party has a run, the result is a conflict, unchanged from BR-1040.
   - The `lore done` holder check (`task-workflow-service.ts`, currently `claim.by !== opts.by`) compares runs.
   - The `lore ready` overlap test compares runs.
4. **Run end.**
   - A migration adds `ended_at` and `end_reason` to `runs`, for both SQLite and Turso.
   - `RunService.end(runId, reason)` and a new CLI verb `lore run end <run-id> --reason <r>`:
     - It releases every clean claim held by the run.
     - It marks a claim `orphaned_dirty` (with the worktree path) when the claim's recorded worktree has uncommitted changes.
     - A claim with no recorded worktree is released, and the release records `worktree: not-measured`. It is never recorded as clean. This mirrors the existing commit-before-attest guard.
     - An unknown run id exits 0 and writes nothing. SubagentStop also fires for internal Claude Code agents, so an unknown id is normal.
   - Registering an ended run again (a resumed helper fires SubagentStart again) reopens it.
5. **Staleness.**
   - A claim whose run is ended and whose worktree is clean is stale at once.
   - An `orphaned_dirty` claim is exempt from age-based staleness. It ends only by `--steal`, whose output names the dirty worktree, or when its worktree becomes clean.
   - The clean re-check is lazy: it runs at claim time and in `lore ready`, with no background sweep.
6. **Hooks.** A shipped `assets/hooks/run-end.mjs` is registered in `HOOK_REGISTRATIONS` twice:
   - on `SessionEnd`, ending the main run `cc:<session_id>`;
   - on `SubagentStop`, ending the subagent run named by the payload's `agent_id`.

   Each registration carries `timeout: 10`, because SessionEnd's default budget is a shared 1.5 s (https://code.claude.com/docs/en/hooks). The hook exits 0 in every case. A failure to end a run must never block or delay the harness beyond the timeout.
7. **Shipped text (#153).** Every shipped surface names only the run path and never `LORE_ACTOR`, not even as a prohibition. The surfaces are CLI help strings, the OS-fallback warning, the anchor-overlap recovery hint, `assets/**`, and repo `CLAUDE.md`.
8. **Measurement.** `lore status --json` reports:
   - for writes in the status window, a count per identity source;
   - the count and oldest age of `orphaned_dirty` claims.

Out of scope: preset role templates (handoff NS5), the score-gated autonomy mechanism (`knowledge-score-gated-autonomy-ai-assesses-decision-factors-the`), and the slice-1 B1/B2 rollout branches.

Unverified harness behaviours. A live probe settles them by observing, end to end, that the shipped hook actually ended the run. The probe therefore runs after the run-end hook is built and installed, and before the task owning AC-ROI-7 is archived. "Relied on" means archived:

- (a) whether SubagentStop fires for a background (`async_launched`) subagent;
- (b) whether `/clear` produces a new `session_id`.

Fallbacks if a probe is negative:

- (a) A background subagent whose SubagentStop does not fire leaves its claims to the implementer protocol's own `lore release` and to TTL. This is today's behaviour, and AC-ROI-7 is then narrowed to foreground subagents.
- (b) If `/clear` keeps the same `session_id`, the SessionEnd(clear) hook ends the run, and the following SessionStart registration reopens it (AC-ROI-6). Ownership stays continuous.

The pre-implementation measurement for ADR decision 2 is done. Of 212 writes after the 2026-10-11T11:42Z rollout, zero were written on behalf of another actor. The only claimed names that differ from the session-derived identity are lore's internal `ai:claude-cli:*` and `system` writers.

## Acceptance Criteria

Structured criteria live in `extra.acceptance_criteria` (`lore ac list <this spec>`). Each one cites its governing rule.


## Acceptance Criteria (structured)

- [·] [script] AC-ROI-1: Every CLI write command and every MCP write tool rejects a caller-supplied identity: no write command declares a by/--by argument and no MCP write tool schema has a by property; the read-side --by filters are exactly the pinned allowlist.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/cli/write-commands-take-no-by.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-ROI-1 PASS: no write surface accepts a caller identity'
  other_command=2
- [·] [script] AC-ROI-2: With LORE_ACTOR set in the environment, actor resolution never returns it and never reports source env, in both the core and the CLI resolver; with no run the resolved source follows session, then worktree, then os, in that order.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/core/actor-resolution-ignores-lore-actor.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-ROI-2 PASS: LORE_ACTOR has no effect on identity'
  other_command=4
- [·] [script] AC-ROI-3: lore done and the lore ready overlap test identify the holder by run: a fresh claim by run A refuses lore done from run B carrying the same derived name, naming run A; overlap between two runs with one name is reported as two holders; a claimant without a run against a holder with a run is a conflict.
  script: test — o=$(mktemp); (bunx --bun vitest run packages/lore/tests/integration/run-owned-done-and-overlap.bun.test.ts) > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-ROI-3 PASS: done and overlap decide by run'
  other_command=5
- [·] [script] AC-ROI-4: lore run end releases every clean claim of the run, marks a claim orphaned_dirty naming its worktree when that worktree has uncommitted changes, releases a claim with no recorded worktree recording worktree not-measured, and exits 0 writing nothing for an unknown run id.
  script: test — o=$(mktemp); (bunx --bun vitest run packages/lore/tests/integration/run-end-releases-claims.bun.test.ts) > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-ROI-4 PASS: run end releases clean claims and keeps dirty ones'
  other_command=2
- [·] [script] AC-ROI-5: A claim of an ended run with a clean worktree is taken by a plain claim at once; an orphaned_dirty claim older than claim_ttl_minutes refuses a plain claim, yields to --steal whose output names the dirty worktree, and becomes stale once its worktree is clean.
  script: test — o=$(mktemp); (bunx --bun vitest run packages/lore/tests/integration/run-end-staleness.bun.test.ts) > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-ROI-5 PASS: ended-run and orphaned_dirty staleness hold'
  other_command=2
- [·] [script] AC-ROI-6: Registering a run that has ended (a resumed helper) reopens it: ended_at is cleared and later claims by that run are owned by it.
  script: test — o=$(mktemp); (bunx --bun vitest run packages/lore/tests/integration/run-end-reopen.bun.test.ts) > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-ROI-6 PASS: a resumed helper reopens its run'
  other_command=2
- [·] [script] AC-ROI-7: HOOK_REGISTRATIONS registers assets/hooks/run-end.mjs on SessionEnd and SubagentStop with timeout >= 10; given a SessionEnd payload the hook ends run cc:<session_id>, given a SubagentStop payload it ends the run of agent_id, and it exits 0 when lore fails.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/hooks/run-end-hook.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-ROI-7 PASS: run-end hook is registered and ends the right run'
  other_command=2
- [·] [script] AC-ROI-8: No shipped surface names LORE_ACTOR: CLI help strings, the OS-fallback warning, the anchor-overlap recovery hint, assets/** and repo CLAUDE.md; the OS-fallback warning and the recovery hint name the agent-integration run path instead.
  script: test — o=$(mktemp); bunx vitest run packages/lore/tests/unit/distribution/no-lore-actor-in-shipped-text.test.ts > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE 'Tests +[0-9]+ passed' $o && echo 'AC-ROI-8 PASS: shipped text names only the run path'
  other_command=2
- [·] [script] AC-ROI-9: lore's internal writers keep their code-set identities: an AI-judge review row records ai:claude-cli:* and a system write records system, with no caller input involved.
  script: test — o=$(mktemp); (bunx --bun vitest run packages/lore/tests/integration/run-only-internal-writers.bun.test.ts) > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-ROI-9 PASS: internal writer identities preserved'
  other_command=1
- [·] [script] AC-ROI-10: lore status --json reports, for writes in the status window, a count per identity source (run, session, worktree, os) and the count and oldest age of orphaned_dirty claims.
  script: test — o=$(mktemp); (bunx --bun vitest run packages/lore/tests/integration/status-identity-source-counts.bun.test.ts) > $o 2>&1; rc=$?; tail -4 $o; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' $o && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' $o && echo 'AC-ROI-10 PASS: status reports identity sources and orphaned_dirty'
  other_command=2
- [·] [human] AC-ROI-11: Live probe in a real Claude Code session, recorded as manual evidence with the observed runs rows: (a) a background (async_launched) subagent's SubagentStop ends its run; (b) /clear yields a new session_id and so a new main run.
  human: Settles the two harness behaviours the hooks docs leave unstated; AC-ROI-7 relies on it.

## Code anchors

- packages/core/src/actor-resolution-node.ts#resolveActorWithSource
- packages/core/src/run-identity.ts#hasClaimConflict
- packages/core/src/task-workflow.ts#isClaimStaleForRun
- packages/lore/src/store/migrations/migration-017.ts
- packages/lore/src/service/run-service.ts
- packages/lore/src/service/gate-predicates.ts
- packages/lore/src/adapters/cli/commands/done.ts
- packages/lore/src/adapters/cli/commands/run.ts
- packages/lore/src/adapters/read-side-by-filters.ts#READ_SIDE_BY_FILTERS
- packages/lore/src/service/attribution-report.ts
- assets/hooks/run-end.mjs
- packages/core/src/distribution-hooks.ts#HOOK_REGISTRATIONS
- packages/lore/tests/unit/cli/write-commands-take-no-by.test.ts
- packages/lore/tests/unit/core/actor-resolution-ignores-lore-actor.test.ts
- packages/lore/tests/integration/run-owned-done-and-overlap.bun.test.ts
- packages/lore/tests/integration/run-end-releases-claims.bun.test.ts
- packages/lore/tests/integration/run-end-staleness.bun.test.ts
- packages/lore/tests/integration/run-end-reopen.bun.test.ts
- packages/lore/tests/unit/hooks/run-end-hook.test.ts
- packages/lore/tests/unit/distribution/no-lore-actor-in-shipped-text.test.ts
- packages/lore/tests/integration/run-only-internal-writers.bun.test.ts
- packages/lore/tests/integration/status-identity-source-counts.bun.test.ts
