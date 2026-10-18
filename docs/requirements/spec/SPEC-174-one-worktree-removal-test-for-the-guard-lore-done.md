---
id: SPEC-174
type: spec
role: spec
title: "One worktree-removal test for the guard, lore done and a sweep"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-17
tags: []
links:
  - {id: SPEC-158, type: supersedes}
---
# One worktree-removal test for the guard, lore done and a sweep

**Goal**: "may this worktree be removed now" is decided in ONE place in lore and consumed by the git-safety hook, `lore done`'s cleanup and a new `lore worktree sweep`; no elapsed-time window remains anywhere. User decision 2026-10-12 (confirming the proposal after `spec-worktree-removal-is-decided-by-who-is-inside-not-by-how` landed).

**Why (measured 2026-10-12)**: after the hook stopped using a 30-minute reflog window, `lore done` still printed `worktree: kept …: recent-activity` for a task whose implementer had stopped — `packages/lore/src/service/worktree-cleanup.ts` carries its own copy of the window (`DEFAULT_WORKTREE_QUIET_MINUTES = 30`, `LORE_WORKTREE_QUIET_MINUTES`). Two copies of one decision drift; one of them is time-based. And neither covers a worktree whose agent stopped but whose session is still live: this session resumed two stopped implementers in their worktrees with SendMessage (a stopped run is reopened on resume), so removing a live session's stopped agent's worktree can strand a resume.

**Baseline**: `baseline-remove-a-seat` BR-1070 (amended: another live session's worktree), BR-1079 (new: lore done + sweep use the same test).

## Scope

- `WorktreeRemovalService` (or equivalent pure decision + IO probe) in `packages/lore/src/service/`: the single test.
- CLI `lore worktree check <path> [--json]` and `lore worktree sweep [--apply] [--json]`.
- `lore done`'s cleanup (`worktree-cleanup.ts`) switched to the single test; `recent-activity`, `DEFAULT_WORKTREE_QUIET_MINUTES`, `parseQuietMinutes` and `LORE_WORKTREE_QUIET_MINUTES` removed.
- `assets/hooks/pre-bash-git-safety-gate.mjs`: the occupancy part of `probeWorktreeRemove` calls `lore worktree check --json` instead of `lore run occupancy` + its own `lsof`/`/proc` scan, so the process scan exists once (in lore). The hook keeps its own clean/merged/HEAD checks and pinned texts.

## Out of scope

- `lore run occupancy` stays (a narrower read the check composes).
- Branch deletion rules other than the plain `git branch -d` after a removal.

## Design Decisions

- **D1 — the test.** Removable iff ALL: a linked worktree (never the main checkout); clean (tracked + untracked); merged into the integration branch; not `git worktree lock`ed; unoccupied (`lore run occupancy` semantics: owning agent run and its parent not ended, no open claim whose run is live); no process other than the caller's own ancestry with its cwd inside (lsof, else `/proc`); and OWNED-OR-ABANDONED: the owning run's session is the caller's session, or that session's main run has ended, or there is no owning run. Each failing clause is a reason token; any unmeasurable clause makes the verdict `not-measured`, never `removable`.
- **D2 — caller session.** The caller's session is the harness session id the CLI already resolves (`CLAUDE_CODE_SESSION_ID` / `CLAUDE_SESSION_ID` → run id `cc:<session>`); the hook passes its payload's `session_id` explicitly (`--session <id>`). An unknown caller session never counts as the owner (same rule as the territory, BR-390).
- **D3 — `lore done`.** After the archive walk, the claim-recorded worktree is evaluated with D1 (caller = the `done` caller) and removed with plain `git worktree remove` + `git branch -d` when removable; otherwise kept and the reason printed. The existing own-commit / claim-time-base checks stay as clauses.
- **D4 — sweep.** Lists every linked worktree with its verdict and reasons; `--apply` removes exactly the removable ones (plain remove + `branch -d`), never forced. It additionally names, as a hint, any worktree kept only because its owning run has no end while every plan/task it claimed is closed — with `lore run end <id> --reason "<why>"`. Plan or task state is never a reason to remove.
- **D5 — no time anywhere.** No reflog age, commit age or claim age is consulted on any of these paths.

## Public Interface

```
lore worktree check <path> [--session <id>] [--json]
  --json → { ok, data: { path, verdict: "removable"|"keep"|"not-measured", reasons: string[],
             owner: { run_id, session, mine: boolean, session_ended: boolean|null } | null,
             occupancy: <lore run occupancy data>, processes: [{ pid, command }] } }
  exit 0 for any verdict (a store failure is the verdict not-measured, D1); 2 on usage.
lore worktree sweep [--apply] [--session <id>] [--json]
  --json → { ok, data: { worktrees: [<check data> + { removed?: boolean, hint?: string }] } }
```

## Edge cases

| Situation | check verdict |
|---|---|
| own stopped agent, merged, clean, last commit 1 min ago | removable |
| another session's stopped agent, that session live | keep: foreign-live-session |
| another session's stopped agent, that session ended | removable |
| hand-made worktree, nobody inside | removable |
| a process inside | keep: process-inside |
| owning run with no end, plan closed | keep: run-not-ended (sweep hint: `lore run end`) |
| lsof and /proc both unavailable, lore store failure | not-measured |
| dirty / unmerged / locked / main checkout | keep with that reason |

## Acceptance Criteria

Declared with `lore ac add` (AC-WS-1..6).


## Acceptance Criteria (structured)

- [⚑] [script] AC-WS-1: The single removal test, pure decision over injected facts (new file worktree-removal-test.test.ts): (a) own stopped agent, clean, merged, newest reflog 60 s old -> removable; (b) another session's stopped agent with that session's main run not ended -> keep, reason foreign-live-session; (c) same with that session ended -> removable; (d) owning run not ended -> keep run-not-ended; (e) process inside -> keep process-inside; (f) dirty / unmerged / locked / main checkout -> keep with that token; (g) any unmeasurable fact -> not-measured, never removable; (h) unknown caller session never counts as owner; (i) no clause reads a time value (the facts type carries no reflog/commit age). Smallest red mutation: dropping the session-ended check fails (b).
  script: test — bunx vitest run packages/lore/tests/unit/service/worktree-removal-test.test.ts
  other_command=3
- [⚑] [script] AC-WS-2: Compiled CLI on a throwaway git repo + mkdtemp corpus (new file worktree-check-sweep-compiled.bun.test.ts; hermetic session ids): lore worktree check on an agent-X worktree whose run was registered and ended by the same --session, merged, clean, last commit seconds old -> verdict removable; with a live run -> keep run-not-ended; from a different --session while the owner session's main run is open -> keep foreign-live-session; lore worktree sweep (no --apply) removes nothing and lists both; sweep --apply removes exactly the removable one (git worktree list no longer shows it, its branch is deleted) and keeps the other; a worktree whose run has no end while its claimed task is archived carries a hint naming 'lore run end'. Smallest red mutation: sweep ignoring --apply's absence removes the worktree in the dry run.
  script: e2e — bun run build && bunx --bun vitest run packages/lore/tests/e2e/worktree-check-sweep-compiled.bun.test.ts
  other_command=4
- [⚑] [script] AC-WS-3: lore done uses the single test (new file done-worktree-cleanup-compiled.bun.test.ts, throwaway repo + corpus, hermetic session ids): a task claimed from a linked worktree whose implementer run has ended, branch merged, clean, last commit seconds old -> lore done exits 0, prints 'worktree: removed', the worktree and its branch are gone; the same with the run still open -> prints 'worktree: kept' with reason run-not-ended and the worktree remains; no output line contains 'recent-activity'. Smallest red mutation: reinstating the quiet window keeps the first worktree.
  script: e2e — bun run build && bunx --bun vitest run packages/lore/tests/e2e/done-worktree-cleanup-compiled.bun.test.ts
  other_command=4
- [⚑] [script] AC-WS-4: The hook delegates occupancy and ownership to lore worktree check (new file git-safety-worktree-check.test.ts, stub lore on PATH): it spawns 'lore worktree check <path> --session <payload session_id> --json' and blocks on keep/not-measured naming each reason (foreign-live-session included), passes on removable; it no longer runs lsof or reads /proc itself (spy: no lsof spawn); the existing occupancy suite stays green after updating only its stub to the check JSON shape. Smallest red mutation: ignoring the foreign-live-session reason passes (b).
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-worktree-occupancy.test.ts packages/lore/tests/unit/hooks/git-safety-worktree-check.test.ts
  other_command=3
- [⚑] [script] AC-WS-5: No second copy remains: worktree-cleanup.ts and the hook contain none of recent-activity, DEFAULT_WORKTREE_QUIET_MINUTES, parseQuietMinutes, LORE_WORKTREE_QUIET_MINUTES or lsof (the process scan lives once, in lore); the assets manifest is fresh. Measured red 2026-10-12: the grep finds the quiet window in worktree-cleanup.ts and lsof in the hook. Smallest red mutation: restoring DEFAULT_WORKTREE_QUIET_MINUTES fails the grep.
  script: other — ! grep -rnE 'recent-activity|DEFAULT_WORKTREE_QUIET_MINUTES|parseQuietMinutes|LORE_WORKTREE_QUIET_MINUTES|lsof' packages/lore/src/service/worktree-cleanup.ts assets/hooks/pre-bash-git-safety-gate.mjs && bun scripts/embed-assets-manifest.mjs --check && echo 'AC-WS-5 PASS: no time window or duplicate process scan left in cleanup or hook'
  other_command=4
- [⚑] [script] AC-WS-6: bun run typecheck exits 0.
  script: tsc — bun run typecheck
  other_command=2

## Code anchors

- packages/lore/src/service/worktree-removal-service.ts
- packages/lore/src/service/worktree-removal-test.ts
- packages/lore/src/service/worktree-cleanup.ts
- assets/hooks/pre-bash-git-safety-gate.mjs
