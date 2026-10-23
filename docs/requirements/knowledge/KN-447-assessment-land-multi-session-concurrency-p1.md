---
id: KN-447
type: knowledge
role: knowledge
title: "Assessment: Land multi-session concurrency P1: queryable ownership of worktrees, branches and sessions (2026-08-12)"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-10-23
tags: []
parent: PLAN-129
links:
  - {id: PLAN-129, type: informs}
---
# Assessment: partially_met (72/100)

Scope: plan `01KZV0A0KC19BJD13WPZ88N00P`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-OWN-1 | 72 | 2 attested passes incl. a sum-equals-total case. But the oracle is unit-level on pure partitionTerritory, and by the module's own invariant a branch enters the discovered set ONLY if a session claimed it or a worktree has it checked out — an unclaimed, unchecked-out branch is never partitioned, so … | task-add-the-two-ownership-read-surfaces-lore-territory-and (expected-fail then 2 attested passes) |
| AC-OWN-2 | 90 | Red-first expected-fail then 3 attested passes; test names cover happy auto-capture, explicit --branch precedence, and the unmeasured case. Production wiring is visible in the diff at claim() (capturedBranch, injected detectBranch defaulting to the real port), so capability and call site are both e… | task-bind-ownership-a-claim-records-its-branch-commits-carry (claim-branch-binding.bun.test.ts 6 pass) |
| AC-OWN-3 | 87 | Red-first then 3 attested passes at the bootstrap level (SessionService.bootstrap → active_sessions[].branches), incl. the detached-HEAD negative yielding []. The producing service file is unseen, but the oracle asserts the live bootstrap payload rather than a schema field. | task-bind-ownership-a-claim-records-its-branch-commits-carry (active-sessions-branches.bun.test.ts 6 pass) |
| AC-OWN-4 | 76 | Red-first then 3 attested passes against real git repos (multi-second runtimes). Mechanism is sound but conditional: install is skipped whenever core.hooksPath points outside the git dir (true of this repo itself), and the marker is a current-state pointer never cleared on release, so post-release … | task-bind-ownership-a-claim-records-its-branch-commits-carry (lore-session-trailer.bun.test.ts 6 pass) |
| AC-OWN-5 | 66 | 2 attested passes, but every shown test name is 'deriveLivenessVerdict (pure)' — the oracle exercises the pure decision function, not `lore session list` as the AC states. Liveness is also only measurable for peers that previously ran the command themselves (tmpdir heartbeat self-registration), so … | task-add-the-two-ownership-read-surfaces-lore-territory-and (session-liveness-probe.bun.test.ts, pure-function cases only) |
| AC-REPLAY-1 | 55 | 3 attested passes but also 1 attested fail. The surviving PASSING test title still reads 'reconstruct 3 of the 4 facts ... the 4th (a per-branch commit COUNT) has no lore surface', so the AC's 'EXACT value for each of the four facts, non-empty' is not demonstrably asserted even after the countUnmer… | task-prove-sufficiency-replay-the-2026-08-11-diagnosis-through (expected-fail, fail, then pass), task-add-a-per-branch-unmerged-commit-count-to-gitport-and (passes carry the same 3-of-4 test title) |

## Gaps

- The only passing evidence for AC-REPLAY-1 — including on the follow-up task that added countUnmergedCommits — carries the test title 'reconstruct 3 of the 4 facts exactly, non-empty; the 4th (a per-branch commit COUNT) has no lore surface'. The AC requires the EXACT value for all four facts with a non-empty assertion on each. Green under that title means the count fact is either still unasserted or asserted outside the replay, so the AC's own no-silent-no-op guarantee is not demonstrated in pac…
- packages/lore/src/adapters/cli/territory-partition.ts states as an invariant that a branch entry exists in the discovered set ONLY because some session's claim named it, and that a branch is never 'unowned' by construction. A local branch that no session claimed and that is checked out in no worktree is therefore absent from all four buckets — dropped, not filed under unmeasured — contradicting AC-OWN-1's 'every branch corpus-wide' and 'NEVER dropped' clauses. Sum-equals-total still holds becau…
- packages/lore/src/adapters/cli/commands/session.ts records liveness only for the CALLING session (recordOwnHeartbeat with process.ppid) into a tmpdir sidecar in packages/lore/src/adapters/session-heartbeat-port.ts. A peer session that has never itself run `lore session list|show` has no heartbeat, so deriveLivenessVerdict returns 'unmeasured' for it. The AC's oracle only exercises the pure verdict function, so the practical coverage of the shipped command — how many real sessions get a non-unme…
- In packages/lore/src/adapters/real-git-port.ts, ensureSessionTrailerHookInstalled returns 'skipped-unsafe-hooks-path' whenever core.hooksPath resolves outside the git dir — the module doc names this repo's own tracked hooks/ as exactly that case. The trailer capability therefore silently does nothing in the repo it was built for. Separately, writeClaimSessionMarker is a current-state pointer with no clearing path on release, so every later commit in that worktree carries the stale session trail…
- packages/lore/src/adapters/cli/commands/territory.ts was amended to state that partitionTerritory 'ALSO measures each entry's unmerged_commits via its own synchronous git probe', and the word 'pure' was deleted from that description. packages/lore/src/adapters/cli/territory-partition.ts was introduced explicitly as pure partitioning logic split out to stay unit-testable without IO; folding blocking subprocess IO into it drifts from that stated contract and from the module's own header.
- packages/lore/src/adapters/cli/commands/territory.ts constructs RealGitPort(app.repoRoot ?? process.cwd()), while the sibling code in packages/lore/src/adapters/real-git-port.ts documents 'deliberately NEVER process.cwd()' as the governing discipline for worktree resolution. The fallback can silently partition a different repo than the corpus describes.

## Recommendations

- Either extend the replay oracle to assert the exact per-branch unmerged-commit count obtained solely from `lore territory --json` (and retitle the test), or restore AC-REPLAY-1 to an attested red. Do not leave a green test whose own name denies the AC.
- Make AC-OWN-1's discovery set explicit: state whether 'every branch corpus-wide' means all local refs (git for-each-ref) or only claim-referenced branches, and add an oracle case for a branch nobody claimed.
- Add a command-level oracle for AC-OWN-5 that runs `lore session list --json` and asserts the liveness field, alongside the existing pure-function unit tests.
- Track the trailer mechanism's known no-op conditions (core.hooksPath outside the git dir, stale marker after release) as declared follow-ups rather than leaving them only in JSDoc.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 119120ms
- Retried: false
- Truncated sections: diff:.lore/export-index.json, diff:packages/lore/tests/unit/adapters/cli/lore-session-trailer.bun.test.ts, diff:packages/lore/tests/unit/service/active-sessions-branches.bun.test.ts, diff:packages/lore/tests/unit/service/claim-branch-binding.bun.test.ts, diff:.lore/export-index.json, diff:packages/lore/src/service/session-service.ts, diff:packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts, diff:packages/lore/tests/unit/service/session-liveness-probe.bun.test.ts, diff:.lore/export-index.json, diff:assets/agents/lore-implementer.md, diff:assets/skills/lore-autopilot/SKILL.md, diff:packages/lore/src/adapters/cli/territory-partition.ts, diff:packages/lore/src/adapters/real-git-port.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/seat-service.ts, diff:packages/lore/tests/integration/real-git-port.test.ts, diff:packages/lore/tests/integration/territory-replay.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts
- Reasoning clipped for: AC-OWN-1, AC-OWN-2, AC-OWN-4, AC-OWN-5, AC-REPLAY-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 74 | 0.7 | evidence | Write side (AC-OWN-2/3/4) is wired and well evidenced; read side lands but AC-OWN-1 branch discovery is claim-derived only and AC-REPLAY-1's fourth fact remains unasserted. |
| evidence_integrity | 64 | 0.65 | evidence | Consistent red-first→green shape and 0.61 attested ratio, but a passing test whose own title denies the AC's fourth fact, plus a pure-function-only oracle for a command-level AC. |
| scope_fidelity | 80 | 0.7 | evidence | Phases followed; the extra count task is honestly traced to AC-REPLAY-1. Drift: partitionTerritory, documented as pure and split out for testability, now runs a synchronous git probe. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | blocker | AC-REPLAY-1 | The only passing evidence for AC-REPLAY-1 — including on the follow-up task that added countUnmergedCommits — carries the test title 'reconstruct 3 of the 4 facts exactly, non-empty; the 4th (a per-branch commit COUNT) has no lore surface'. The AC requires the EXACT value for all four facts with a non-empty assertion on each. Green under that title means the count fact is either still unasserted or asserted outside the replay, so the AC's own no-silent-no-op guarantee is not demonstrated in pac… |
| outcome | major | AC-OWN-1 | packages/lore/src/adapters/cli/territory-partition.ts states as an invariant that a branch entry exists in the discovered set ONLY because some session's claim named it, and that a branch is never 'unowned' by construction. A local branch that no session claimed and that is checked out in no worktree is therefore absent from all four buckets — dropped, not filed under unmeasured — contradicting AC-OWN-1's 'every branch corpus-wide' and 'NEVER dropped' clauses. Sum-equals-total still holds becau… |
| outcome | major | AC-OWN-5 | packages/lore/src/adapters/cli/commands/session.ts records liveness only for the CALLING session (recordOwnHeartbeat with process.ppid) into a tmpdir sidecar in packages/lore/src/adapters/session-heartbeat-port.ts. A peer session that has never itself run `lore session list\|show` has no heartbeat, so deriveLivenessVerdict returns 'unmeasured' for it. The AC's oracle only exercises the pure verdict function, so the practical coverage of the shipped command — how many real sessions get a non-unme… |
| outcome | major | AC-OWN-4 | In packages/lore/src/adapters/real-git-port.ts, ensureSessionTrailerHookInstalled returns 'skipped-unsafe-hooks-path' whenever core.hooksPath resolves outside the git dir — the module doc names this repo's own tracked hooks/ as exactly that case. The trailer capability therefore silently does nothing in the repo it was built for. Separately, writeClaimSessionMarker is a current-state pointer with no clearing path on release, so every later commit in that worktree carries the stale session trail… |
| scope_fidelity | minor | AC-OWN-1 | packages/lore/src/adapters/cli/commands/territory.ts was amended to state that partitionTerritory 'ALSO measures each entry's unmerged_commits via its own synchronous git probe', and the word 'pure' was deleted from that description. packages/lore/src/adapters/cli/territory-partition.ts was introduced explicitly as pure partitioning logic split out to stay unit-testable without IO; folding blocking subprocess IO into it drifts from that stated contract and from the module's own header. |
| scope_fidelity | minor | AC-OWN-1 | packages/lore/src/adapters/cli/commands/territory.ts constructs RealGitPort(app.repoRoot ?? process.cwd()), while the sibling code in packages/lore/src/adapters/real-git-port.ts documents 'deliberately NEVER process.cwd()' as the governing discipline for worktree resolution. The fallback can silently partition a different repo than the corpus describes. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Either extend the replay oracle to assert the exact per-branch unmerged-commit count obtained solely from `lore territory --json` (and retitle the test), or restore AC-REPLAY-1 to an attested red. Do not leave a green test whose own name denies the AC. | The surviving pass and the AC statement contradict each other, which defeats the sufficiency proof the phase exists to provide. |
| spec | Make AC-OWN-1's discovery set explicit: state whether 'every branch corpus-wide' means all local refs (git for-each-ref) or only claim-referenced branches, and add an oracle case for a branch nobody claimed. | Sum-equals-total is vacuous when the total is defined by the same claim-derived set the partition builds. |
| spec | Add a command-level oracle for AC-OWN-5 that runs `lore session list --json` and asserts the liveness field, alongside the existing pure-function unit tests. | The AC names the command surface; the current oracle only proves the pure decision function, which the plan itself warns is not a shipped command. |
| process | Track the trailer mechanism's known no-op conditions (core.hooksPath outside the git dir, stale marker after release) as declared follow-ups rather than leaving them only in JSDoc. | Both conditions make an attested-green capability inert or wrong in production, and neither is covered by the AC's negative case. |

## Unverifiable Materials

- packages/lore/tests/integration/territory-replay.bun.test.ts: Truncated; the final assertions for AC-REPLAY-1's four facts could not be read, so only the shown test titles and tails informed the score.
- packages/lore/src/adapters/cli/territory-partition.ts (final version, post unmerged_commits change): Only the initial creation diff was shown; the git-probe integration and unmerged_commits emission are described only in territory.ts's header.
- packages/lore/src/adapters/real-git-port.ts::countUnmergedCommits: Implementation omitted; existence inferred from the GitPort interface stub added to seat-list.test.ts.
- packages/lore/src/service/session-service.ts: Omitted; getActiveSessions / deriveSessionLiveness / recordOwnHeartbeat behaviour judged only from callers and test titles.
- assets/ merge-protocol change and regenerated assets manifest: Listed as changed but omitted; the doc content change AC-REPLAY-1's task requires could not be inspected.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 9
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.61
