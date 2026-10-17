---
id: SPEC-171
type: spec
role: spec
title: "Worktree removal is decided by who is inside, not by how long it has been quiet"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-17
tags: []
---
# Worktree removal is decided by who is inside, not by how long it has been quiet

**Goal**: the git-safety gate lets a clean, merged worktree be removed as soon as nobody is working in it, and refuses while somebody is — judged by direct occupancy signals (the owning agent run has not ended, a process stands inside, an open claim's run is alive), never by elapsed time since the last commit. User decision 2026-10-12: "如果限制的是时间就不合理，直接改".

**Why (measured 2026-10-12)**: four implementer worktrees of this session, all clean and merged, were refused for 30 minutes although their agents had already stopped — `runs.ended_at` was written at subagent stop for every one (`subagent-stop`, 05:50–06:11Z). The 30-minute reflog window (`WORKTREE_LIVENESS_WINDOW_MINUTES`, `assets/hooks/pre-bash-git-safety-gate.mjs`) was chosen on 2026-08-02 (`knowledge-three-signals-said-a-peer-s-worktree-was-safe-to`) when no liveness signal existed: claim age is a lease, not a heartbeat. Since then the run registry records every agent run and its end (`run-register.mjs` / `run-end.mjs`, SubagentStop + SessionEnd). Elapsed time is both too strict (a stopped agent still blocks for 30 minutes) and too loose (an agent thinking for 31 minutes without a commit is unprotected).

**Baseline**: `baseline-remove-a-seat` BR-1070 (new; removal of any worktree, seat or not).

## Scope

- New read `lore run occupancy --worktree <path> [--json]`: the worktree's owning agent run and the open claims recorded for it, each with whether its run has ended.
- `assets/hooks/pre-bash-git-safety-gate.mjs` `probeWorktreeRemove`: after the existing clean + merged checks, replace the reflog-window check with the three occupancy signals; delete `WORKTREE_LIVENESS_WINDOW_MINUTES` and `minutesSinceLastReflogActivity`.

## Out of scope

- The dirty / unmerged / unparseable refusals and their pinned texts — unchanged.
- `git worktree remove --force`, `git reset --hard`, branch deletion and the other rules of the gate — unchanged except that a forced remove of a clean, merged, unoccupied worktree gets the same "SAFE — run it yourself" assessment it gets today.
- Process liveness by pid for claims (`lore session`) — not reused: runs carry no pid.

## Design Decisions

- **D1 — owning run from the harness's worktree name.** Claude Code names a subagent worktree `agent-<agentId>` and registers that agent's run with `agent_ref = <agentId>`. `occupancy` parses the basename `^agent-([A-Za-z0-9]+)$`; for a match it reads every run with that `agent_ref` (a resumed agent can re-register): `agent_run` reports the most recently registered one, and the worktree is occupied if ANY of them is live. A run counts as live iff neither it nor its parent run has an end recorded (a session's end ends its agents). Any other basename has no owning run (`agent_run: null`). Rejected: matching on `runs.branch` (null for every subagent run measured today).
- **D2 — open claims.** A non-terminal task whose `extra.claim.worktree` equals the worktree's branch or resolves (realpath, ENOENT → `path.resolve`) to the same directory, and whose claim names a run (`extra.claim.harness_run`): live iff that run has no end (a run end normally releases its claims, BR-1059, so this mostly catches runs still going). A claim with no `harness_run` is reported `run_ended: null` (not measured) and counts as occupied.
- **D3 — process inside, measured by the hook.** `lsof -n -d cwd -F pn` lists every process's working directory (on a host without `lsof`, Linux `/proc/<pid>/cwd` links are read instead); any pid other than the hook's own ancestry (its pid, its parent chain) whose cwd is the worktree or under it occupies it. This is an OS fact, so it lives in the hook, not in lore.
- **D4 — unmeasurable means refused.** `lore` missing or exiting non-zero, `occupancy` output that does not parse, or neither `lsof` nor `/proc` available → refuse, naming which signal could not be measured. No time-based fallback.
- **D5 — the way out is explicit.** A refusal for a live run names the run id and `lore run end <id> --reason "<why>"` for an agent known to be gone (audited, and it releases that run's claims); for a process it names pid and command; for a claim it names the task.
- **D6 — no time anywhere.** Recency of commits or reflog is not consulted on this path.

## Public Interface

```
lore run occupancy --worktree <path> [--json]
--json → { "ok": true, "data": {
  "worktree": "<realpath>",
  "agent_run": { "id": "<run id>", "ended": boolean, "parent_ended": boolean | null } | null,
  "open_claims": [ { "task_slug": string, "run_id": string | null, "run_ended": boolean | null } ],
  "occupied": boolean            // agent_run live OR any open claim not ended (null counts as not ended)
} }
exit 0 on success; 2 without --worktree; 1 on a store failure.
```

## Edge cases

| Situation | Hook outcome |
|---|---|
| clean, merged, agent run ended, no process inside, no open claim, last commit 1 minute ago | allowed (no block) |
| same, agent run has no end | refused: names run id + `lore run end` |
| same, run open but its parent run ended | allowed |
| hand-made worktree (no `agent-` name), a shell's cwd inside | refused: names pid + command |
| open claim recorded for it whose run is alive, or claim has no run id | refused: names task |
| `lore` not on PATH / exits non-zero | refused: "cannot measure the owning run" |
| neither `lsof` nor `/proc` available | refused: "cannot measure processes inside" |
| dirty / unmerged / unparseable | unchanged refusals |
| `--force` on a clean, merged, unoccupied worktree | today's SAFE assessment (still blocked for self-run) |

## Acceptance Criteria

Declared with `lore ac add` (AC-WL-1..5).


## Acceptance Criteria (structured)

- [⚑] [script] AC-WL-1: Run occupancy read on InMemoryStore (new file run-occupancy.test.ts): (a) worktree basename agent-X with a registered subagent run agent_ref X that has an end -> agent_run.ended true, occupied false; (b) the same run with no end -> occupied true; (c) run open but its parent run ended -> parent_ended true, occupied false; (d) basename without the agent- prefix -> agent_run null; (e) a non-terminal task whose claim.worktree is the worktree's branch, or an absolute path resolving to the same directory, with claim.harness_run naming a run with no end -> listed with run_ended false, occupied true; a claim with no harness_run -> run_ended null, occupied true; an archived task's claim is not listed; (f) two runs with the same agent_ref, the older one live and the newer one ended -> agent_run names the newer, occupied true; (g) store write spy count 0. Smallest red mutation: ignoring parent_ended fails (c); dropping the terminal-status filter fails (e).
  script: test — bunx vitest run packages/lore/tests/unit/service/run-occupancy.test.ts
- [⚑] [script] AC-WL-2: Compiled CLI on a throwaway corpus (mkdtemp + lore init; new file run-occupancy-compiled.bun.test.ts): after lore run register --harness claude-code --session S --agent-id X --agent-type t, lore run occupancy --worktree <dir>/agent-X --json exits exactly 0 with data.occupied true and data.agent_run.id naming the run; after lore run end <that id> --reason r the same call reports occupied false and agent_run.ended true; without --worktree it exits exactly 2. Smallest red mutation: occupancy not reading the run end keeps occupied true after the end.
  script: e2e — bun run build && bunx --bun vitest run packages/lore/tests/e2e/run-occupancy-compiled.bun.test.ts
- [⚑] [script] AC-WL-3: The real git-safety hook on a real throwaway git repo with a linked worktree that is clean and merged and whose last commit is under one minute old, with stub lore and lsof executables first on PATH (new file git-safety-worktree-occupancy.test.ts): (a) occupancy reports not occupied and lsof lists no foreign cwd inside -> the hook passes the git worktree remove through (no block); (b) occupancy occupied by an agent run -> blocked, stderr names the run id and 'lore run end'; (c) lsof lists a foreign pid whose cwd is under the worktree -> blocked naming the pid; (d) an occupied open claim -> blocked naming the task; (e) lore missing from PATH, or exiting 1 -> blocked naming the owning-run signal as not measurable; (e2) lore exiting 0 with output that is not the documented JSON -> blocked as not measurable; (f) lsof missing and no /proc -> blocked naming the process signal as not measurable; (g) the hook's own process ancestry standing in the worktree does not count; (h) a dirty or unmerged worktree keeps today's refusal texts. Smallest red mutation: reinstating any elapsed-time check fails (a).
  script: test — bunx vitest run packages/lore/tests/unit/hooks/git-safety-worktree-occupancy.test.ts
- [⚑] [script] AC-WL-4: No time-based liveness remains: the hook source has no WORKTREE_LIVENESS_WINDOW_MINUTES, minutesSinceLastReflogActivity or 'liveness window'; the assets manifest is fresh; the existing gate suite (with its retired reflog-window cases AC2/AC4 deleted, nothing skipped), distribution-hooks and assets-ssot stay green. Measured red 2026-10-12: the grep finds the constant. Smallest red mutation: restoring the constant fails the grep.
  script: test — ! grep -nE 'WORKTREE_LIVENESS_WINDOW_MINUTES|minutesSinceLastReflogActivity|liveness window' assets/hooks/pre-bash-git-safety-gate.mjs && bun scripts/embed-assets-manifest.mjs --check && bunx vitest run packages/lore/tests/unit/hooks/git-safety-gate.test.ts packages/lore/tests/unit/core/distribution-hooks.test.ts packages/lore/tests/unit/assets-ssot.test.ts
- [⚑] [script] AC-WL-5: bun run typecheck exits 0 with the occupancy read wired through the store, service and CLI.
  script: tsc — bun run typecheck

## Code anchors

- assets/hooks/pre-bash-git-safety-gate.mjs
- packages/lore/src/service/worktree-removal-test.ts
