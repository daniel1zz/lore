---
id: KN-127
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-071 execution liveness signals (2026-07-23)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-051
links:
  - {id: PLAN-051, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01KY7N8H44H6AF755TZDYR0QQ6`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-069-1 | 92 | 3 pass (2 attested), 0 fail. Diff shows the full precedence chain (explicit > env > session via CLAUDE_CODE_SESSION_ID ?? CLAUDE_SESSION_ID > os-fallback), ActorSource gains 'session', and actor-session-tier.test.ts uses literal env objects throughout — zero process.env mutation, as required. | 01KY7NB2JMK93HTXH9BDKGGTJF (attested runs [1]/[10]: 13 then 17 tests pass), 01KY7NB12M6M0K43TDD2ME155D (F1 worktree scoped run (self-reported)) |
| AC-069-2 | 85 | 3 pass (2 attested). sessionActorFromId is fail-loud on sanitize-to-empty and never returns a bare prefix; tests pin prefix, truncation, and throw paths. Minor: AC says sanitization 'strips' non-[a-z0-9-] but implementation collapses runs to '-' (seat.ts semantics) — tests assert and pass the colla… | 01KY7NB2JMK93HTXH9BDKGGTJF (attested runs [2]/[11]: 10 tests pass), 01KY7NB12M6M0K43TDD2ME155D (F1 worktree scoped run (self-reported)) |
| AC-069-3 | 93 | 3 pass (2 attested). Full truth table visible in diff: same-holder fresh/stale renew with branch/machine/worktree preserved, foreign holder -> null, undefined -> null, input unmutated via toStrictEqual before/after snapshots. Implementation is a clean 3-line pure fn matching spec exactly. | 01KY7NB2JMK93HTXH9BDKGGTJF (attested runs [3]/[12]: 10 tests pass), 01KY7NB20GB9N5JS1PTMH29P10 (F2 worktree scoped run (self-reported)) |
| AC-069-4 | 87 | 3 pass (2 attested). Diff shows renewal folded into the same newExtra passed to writeTaskExtra with claim_renewed audit detail and explicit reuse of the captured nowIso (single now() fire, STALE_VERSION recipe preserved). Task-side test file omitted from diff (present but unseen); attested runs cov… | 01KY7NB2JMK93HTXH9BDKGGTJF (attested runs [4]/[13]: 6 tests pass), 01KY7NB20GB9N5JS1PTMH29P10 (F2 worktree scoped run (self-reported)) |
| AC-069-5 | 91 | 3 pass (2 attested). Phase parity test is fully visible: single version bump (delta === 1), claim.at === evidence recorded_at, claim_renewed audit detail, foreign-holder byte-identical, stale-holder renewal, no-claim absent. Grew 5→6 tests between attested runs, both green. | 01KY7NB2JMK93HTXH9BDKGGTJF (attested runs [5]/[14]), 01KY7NB20GB9N5JS1PTMH29P10 (F2 worktree scoped run (self-reported)) |
| AC-069-6 | 91 | 3 pass (2 attested). deriveLastActivityAt totality (zero tasks, multi-task max, ties) tested; SessionService.bootstrap populates the field with zero extra store calls; NEGATIVE fail-loud parse test present with a REGRESSION control. Required field added to schema + TS shape together as planned. | 01KY7NB2JMK93HTXH9BDKGGTJF (attested runs [6]/[15]: 9 tests pass), 01KY7NB1HCAHPMA3H28Y40VGF9 (F3 worktree scoped run (self-reported)) |
| AC-069-7 | 92 | 2 pass (2 attested), 0 fail. Whole-repo typecheck (5 tsconfig projects) attested green on main both before and after the post-merge T4 hygiene commit. | 01KY7NB2JMK93HTXH9BDKGGTJF (attested runs [7]/[16]) |
| AC-069-8 | 75 | 2 attested pass, 1 attested fail. The fail run [17] shows 301 files / 5423 tests all passing but 'Errors 1 error' (unhandled error, not a test failure); a subsequent attested run [18] passes. Final state green, but the fail's root cause and what changed between runs is not documented in evidence. | 01KY7NB2JMK93HTXH9BDKGGTJF (runs [8] pass, [17] fail (1 vitest error), [18] pass) |

## Gaps

- The attested `bun run test` fail (evidence [17]: 301 files / 5423 tests pass but vitest reports 'Errors 1 error') is followed by an attested pass [18] with no recorded diagnosis or intervening change. The suite is green on main, but the trail cannot show whether the error was fixed, environmental, or a flake that could recur.
- Plan invariant 5 (no Node builtins in the new pure functions / browser-safe core) ends up verified only by manual import review — the final CLAUDE.md edit concedes barrel-isolation.test.ts does not pin generic Node-builtin reachability. session-actor.ts imports only ./seat.js so the invariant likely holds, but it is not mechanically enforced.
- The post-merge T4 commit adds a try/catch in resolveActorWithSource so a non-whitespace session id that sanitizes to empty (e.g. '!!!') degrades to os-fallback instead of throwing. Well-commented and consistent in spirit, but it changes the session tier's error behavior after the planned F1 slice landed, with no scope-alt declared for it in the plan.
- F3's approach required verifying MCP lore_bootstrap passes the report through without reshaping ('note finding in completion report'); no such finding appears in any evidence record, and the exit criterion 'lore assess run; findings triaged' carries no evidence.

## Recommendations

- Require an annotation (root cause, fix commit, or 'flake — rerun green') on any attested fail evidence that is later superseded by a pass on the same command, before the task can be archived.
- Add a follow-up task: a static import-graph test asserting the @lore/core default barrel (including session-actor.ts) reaches no Node builtins, restoring a mechanical pin for plan invariant 5.
- Amend AC-069-2's statement from 'sanitization strips non [a-z0-9-]' to 'collapses non-[a-z0-9-] runs to a single hyphen (sanitizeBranchSegment semantics)', matching the tested and shipped behavior.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 80582ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/task-workflow-evidence-renewal.test.ts, diff:CLAUDE.md, diff:packages/lore/tests/unit/adapters/cli-utils.test.ts, diff:packages/lore/tests/unit/adapters/cli-utils.test.ts, diff:packages/lore/tests/unit/cli/actor-session-tier.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-evidence-renewal.test.ts
- Reasoning clipped for: AC-069-2, AC-069-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.85 | evidence | All 8 ACs carry attested passes; diff confirms the three vertical slices (session tier, single-CAS claim renewal, required last_activity_at) match spec design decisions closely. |
| evidence_integrity | 78 | 0.8 | evidence | T4 attested runs (17) anchor the trail; implementer tasks are self-reported only (ratio 0.63), one manual oracle bundles merge+drift+docs, and the AC-069-8 fail→pass lacks a causal note. |
| scope_fidelity | 82 | 0.75 | evidence | Slices stayed file-disjoint per plan; drift is minor: unplanned post-merge try/catch tier, browser-safety pin downgraded to manual review, mid-stream SPEC renumber 071→069 IDs (explained). |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-069-8 | The attested `bun run test` fail (evidence [17]: 301 files / 5423 tests pass but vitest reports 'Errors 1 error') is followed by an attested pass [18] with no recorded diagnosis or intervening change. The suite is green on main, but the trail cannot show whether the error was fixed, environmental, or a flake that could recur. |
| outcome | minor | AC-069-2 | Plan invariant 5 (no Node builtins in the new pure functions / browser-safe core) ends up verified only by manual import review — the final CLAUDE.md edit concedes barrel-isolation.test.ts does not pin generic Node-builtin reachability. session-actor.ts imports only ./seat.js so the invariant likely holds, but it is not mechanically enforced. |
| scope_fidelity | minor | AC-069-1 | The post-merge T4 commit adds a try/catch in resolveActorWithSource so a non-whitespace session id that sanitizes to empty (e.g. '!!!') degrades to os-fallback instead of throwing. Well-commented and consistent in spirit, but it changes the session tier's error behavior after the planned F1 slice landed, with no scope-alt declared for it in the plan. |
| evidence_integrity | minor | — | F3's approach required verifying MCP lore_bootstrap passes the report through without reshaping ('note finding in completion report'); no such finding appears in any evidence record, and the exit criterion 'lore assess run; findings triaged' carries no evidence. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require an annotation (root cause, fix commit, or 'flake — rerun green') on any attested fail evidence that is later superseded by a pass on the same command, before the task can be archived. | AC-069-8's fail→pass pair is currently uninterpretable; a one-line note would make the regression floor trustworthy instead of merely green-at-last-run. |
| plan | Add a follow-up task: a static import-graph test asserting the @lore/core default barrel (including session-actor.ts) reaches no Node builtins, restoring a mechanical pin for plan invariant 5. | The verification docs now explicitly state browser-safety rests on manual review only — a regression here would ship silently. |
| spec | Amend AC-069-2's statement from 'sanitization strips non [a-z0-9-]' to 'collapses non-[a-z0-9-] runs to a single hyphen (sanitizeBranchSegment semantics)', matching the tested and shipped behavior. | The AC text and the pinned test behavior currently disagree on strip-vs-collapse; the tests are the truth and the spec should say so. |

## Unverifiable Materials

- Root cause of AC-069-8 attested fail (evidence [17], 1 vitest error): Output tail truncates before the error detail; no note records what changed before the passing rerun [18].
- MCP lore_bootstrap pass-through verification (F3 approach item): No finding recorded in any task evidence or completion report.
- lore assess run + findings triage (plan exit criterion): No evidence record present in the provided materials.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.63
