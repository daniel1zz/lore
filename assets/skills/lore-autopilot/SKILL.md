---
name: lore-autopilot
description: "Use when user says 'autopilot', 'run all tasks', 'execute the plan', 'drive until done', 'auto-execute', '自动执行', or wants all ready tasks of a lore plan executed without manual intervention."
---

# Lore Autopilot — Drive a Plan Until Done

You are in **autopilot mode** for a lore plan. Execute ALL ready tasks autonomously via
lore-implementer subagents. Do NOT stop to ask the user except for the Major Decisions
defined below. Run until the plan is drained or every remaining task is genuinely blocked.

## Arguments: $ARGUMENTS

- `$ARGUMENTS` names a plan (ID or slug) → drive that plan.
- Empty → `lore bootstrap --json` → if exactly one active plan, drive it; multiple → AskUserQuestion to pick.
- No `.lore/` in the project → **stop**: suggest `lore init`; autopilot has nothing to drive.

Environment: keep `CLAUDECODE=1` exported (lore AI-assist defaults OFF for agents, SPEC-024).
All corpus state lives in lore — it is the SSOT; never track task state in parallel files.

---

## Doctrine (3 First-Principles)

⛔ **D1 — Default Unattended**
- Ready tasks execute without "continue?" prompts. Oracle failures enter the Fix Loop, they do not escalate. This is the execution half of the single batched governance flow (`shared/batched-governance.md`) — the user's approval was given once, in S4, before execution.

⛔ **D2 — Best Solution First**
- ≥2 candidate approaches → Sequential-Thinking before locking in. No hacks / TODO-later / silent fallbacks (`Skill(my-best-practice)` semantics apply inside implementers too).

⛔ **D3 — Fix Loop, not escalation**
- Any oracle FAIL (tsc / test / lint / `lore verify`) → fix → re-run. Max 3 cycles per failure; cycle 3 still failing → `Skill(diagnose)` root-cause; still failing → mark the task blocked (release with `--reason`), continue with the next ready task.

## Major Decisions (the ONLY AskUserQuestion escalations)

| # | Trigger |
|---|---------|
| M1 | Operation costs money (paid API beyond budget, cloud resources) |
| M2 | Irreversible/destructive at shared scope (force-push main, prod data, `--steal` a fresh claim, `LORE_GATE_BYPASS`) |
| M3 | Requires human credentials / 2FA / identity |
| M4 | Genuine tie between ≥2 candidates after a full Sequential-Thinking cycle |
| M5 | Required change is OUT OF SCOPE of the plan (new spec/feature — plan boundary is contract) |

Everything else (test failures, gate denials, ≤3 blocked tasks, claim conflicts) → handle per the loops below.

---

## Phase 1 — Discovery

1. `lore ready <plan> --json` → the readiness report:
   - `counts` — `{ready, claimed, archived, total}`; use `counts.ready` for the ready count
   - `records[]` — every task row, archived included (status + blockers computed over `blocks` links); filter `ready === true` to list ready tasks
   - `sessions[]` — fresh claims grouped by `(by, machine, worktree)`: who else is already working
   - `anchor_conflicts[]` — pre-existing anchor overlaps
2. `lore get <plan>` + `lore tree <plan>` → phases, task bodies; note the governing spec (parent) and `lore ac list <spec>` for its structured ACs.
3. Ensure main is current: `git pull --rebase origin main` (worktrees are created off current HEAD).
4. Announce:
   ```
   **[AUTOPILOT START]** plan: {slug}
   Ready: {n} | Active sessions: {n} | Anchor conflicts: {n} | Blocked: {n}
   ```
   Foreign fresh sessions already hold tasks in this plan → treat those tasks as taken (skip them, report the holders); never `--steal`.

## Phase 2 — Anchor Partitioning

Partition ready tasks by declared `extra.file_anchors` (from `lore ready --json` / `lore get <task>`):

- **Non-overlapping anchors → concurrent wave.** Dispatch together.
- **Overlapping anchors → serialize.** Queue behind the first; dispatch the next only after the previous branch is merged back to main.
- **Task with NO declared anchors → serialize with everything** (the claim gate can only see declared anchors; an undeclared conflict is invisible to it — orchestrator queueing is the defense-in-depth).

## Phase 3 — Dispatch (per task)

Dispatch one `lore-implementer` subagent per task, **worktree isolated**
(`Agent(subagent_type="lore-implementer", isolation="worktree")`). Same-wave tasks go in one
message (parallel). ⛔ **Bundle source of truth (SPEC-070): run `lore feed task-start <task>` and paste its pack as the bundle core** — it deterministically renders objective/acceptance (with live coverage badges + script-AC oracle commands)/constraints (prior-failure anti-patterns)/boundaries (anchors + scoped-oracle line)/claim/plan_state/knowledge_pointers/handoff from corpus state, so the bundle is always fresh and resume ≡ first dispatch. Hand-assemble ONLY what the pack cannot know (e.g. session-specific merge-base, retry anti-pattern notes not yet in evidence). The pack covers the five mandatory sections:

1. **Task Objective** — task slug + title + one-line goal
2. **Spec Reference** — governing spec slug (implementer runs `lore get` / `lore ac list` itself)
3. **AC** — the acceptance criteria this task must satisfy (with `ac-id`s for `--ac` evidence refs)
4. **Context Digest** — key decisions/constraints, ≤15k tokens
5. **File Anchors** — the task's declared anchors (its write scope)

Identity needs no export: it comes from the agent integration, which registers each implementer's run and attests its writes (the anchor-overlap gate keys on those runs).

⛔ **First command inside a fresh worktree: `bun install`** — a fresh worktree has no local `node_modules/@lore/*` workspace symlinks; module resolution silently walks UP into the main checkout's node_modules, so every oracle tests STALE `@lore/core`/`@lore/lore` source (live finding 2026-07-19). Install before claiming, before any oracle.

**The implementer claims from INSIDE its worktree** — `lore claim <task> --worktree <branch>` — never pre-claimed by the orchestrator. It then implements, runs oracles, records `lore evidence` (result from the oracle's exit status, never self-asserted), and `lore release`.

⛔ **Dispatch bundles MUST scope the implementer's oracles** — AC test files (`-t "AC-…"` with matched-count assertion), `bunx vitest run --changed <merge-base>`, anchor-matching `.bun.test.ts` files, and `bun run typecheck` — NEVER the full suite. The full suite runs ONCE, on main, by the orchestrator after merge (Phase 4 step 2). N worktrees × full suite on one machine starves subprocess-spawning tests into 30s-timeout cascades that present as fake regressions (2026-07-23: load 150, 70+ phantom failures across two agents).

Enforced by the task-claim gate (identity and claim placement):

- `lore claim <task>`. For concurrent worktree dispatch, identity is assigned by the agent integration (each run is registered and attested, no export needed) and have each implementer claim from inside its own worktree (`--worktree` declared explicitly).

Enforced by the task-claim gate (upstream governance docs):

- Before each dispatch re-check that the upstream governance docs are claimable: a sibling task's wrap-up can block a later claim that the implementer cannot self-resolve. Re-check one by one, never from the batch-start snapshot.

Enforced by the task-claim gate (`gate:task-claim:anchor-overlap`):

- File mutex: tasks declare `--anchor` file anchors and a concurrent claim with an intersecting anchor is denied (`gate:task-claim:anchor-overlap`). Read `lore ready <plan> --json` (sessions / anchor_conflicts) first; manual queueing is defense in depth for anchors never declared.

### Claim-conflict handling (exit 5 / `CLAIM_CONFLICT`)
Implementer reports the claim was rejected → **skip the task**, record the holder in the final
report. ⛔ NEVER `--steal` and never `lore release --force` a foreign claim without explicit
user say-so (that is an M2 escalation if the task is critical-path).

### Gate-denial handling (exit 4, `gate:*` field)
A gate denial arrives with a **feeding pack** naming exactly what is missing (e.g. unapproved
upstream spec, anchor overlap). Read the pack → fix the actual precondition (e.g. get the spec
through `lore review` + `lore approve`, adjust anchors via `lore anchor`, re-order the queue) →
retry the claim. ⛔ NEVER set `LORE_GATE_BYPASS=1` — gate escape is user-only say-so.

## Phase 4 — Collect, Merge, Verify

On each implementer return:

1. **Merge immediately** — `git merge <branch> --no-ff`; never batch merges. ⛔ GATE every downstream step (archive, readiness re-check, next dispatch) on the merge's EXIT CODE — an `&&`-chain or explicit check, never an unconditional command sequence (live incident 2026-07-19: 'strategy ort failed' on untracked-file collision + unconditional archive chain → task archived while its code was NOT on main). Untracked-file collision → diff the copies first; identical → remove the stale untracked copy and re-merge. Conflict → dispatch a fresh subagent to resolve. After merge confirmed (`git branch --merged main`), run `lore done <task>`: it resolves the branch-name claim to its worktree and removes the worktree itself, then prints one line: `worktree: removed <path>` (done), `worktree: gone ...` (already absent, nothing to do) or `worktree: kept <path>: <reason>`. On `kept`, follow the named reason (commit or merge what it names, or wait for the live session inside) and re-run; ⛔ never `--force` and never remove the worktree by hand.
   **Orphan-branch sweep — `lore territory --json`, never `git branch -a`.** A subagent's own internal re-dispatch can open a branch this round's return never mentions, so the sweep runs every round, not only when a return looks incomplete. Partition its output and act ONLY on `mine` (yours — merge/clean up per the paragraph above) and `unowned` (no session claims it — safe to inspect, and remove if genuinely stray) entries. ⛔ NEVER touch a `foreign` entry — its `holder.session_id`/`by`/`worktree` name a LIVE peer session; git topology alone carries no ownership, and reading a peer's in-flight branch as an orphan via raw `git branch -a` + `git log main..<branch>` is the exact 2026-08-11 incident this replaces. A branch reported `unmeasured` (ownership could not be determined) is NOT `unowned` — never act on it; name it in the round report instead.
2. **Check evidence** — `lore get <task> --json` → `extra.verification_evidence` must carry passing oracle entries for the task's ACs. Missing/failing evidence → failure loop below.
3. **Attested verification** — after merging, run the trusted runner on main:
   ```
   lore verify <plan> --task <task> --allow-new-commands
   ```
   Exit code decides (never self-asserted); exit 7 without the flag = a new command needs approval — the flag is the sanctioned non-interactive path, but eyeball the command it names first (a planted `verify.command` runs with your shell privileges — suspicious command → M2 escalation, do not run).
   FAIL → Fix Loop (D3) on main, then re-run `lore verify`.
4. **Round end** — run `lore worktree sweep --apply` once: it removes exactly the worktrees that are removable (plain remove, then `git branch -d`) and reports a reason for each one it keeps; follow those reasons, never force.
5. Loop back to Phase 1 (`lore ready <plan> --json`) — completed work may have unblocked downstream tasks; dispatch the next wave.

### Failure loop (per task)
- **Retry ≤2**: `SendMessage` back to the SAME implementer with the failure output (oracle text, verify attestation, review findings) — it keeps its context.
- **Both retries exhausted**: discard that worktree, dispatch a FRESH implementer with the failure summary injected as an explicit anti-pattern note ("previous attempt failed because X — do not repeat").
- **Fresh agent also fails**: `lore release <task> --reason "<failure summary>" --force` if the agent left a claim, mark blocked in the report, continue with other ready tasks.

## Phase 5 — Plan Closure

When `lore ready <plan>` returns no ready tasks and nothing is in flight:

1. **Full-plan attested run**: `lore verify <plan> --allow-new-commands` (all script-mode ACs). FAIL → Fix Loop.
2. **Project oracles** on main: typecheck + full test suite (whatever the repo's CLAUDE.md names). FAIL → Fix Loop.
3. **LLM-as-judge closure — batched** (`~/.claude/skills/shared/batched-governance.md` § Execution and closure): if other plans of the same initiative still have ready/in-flight tasks, DEFER assess and report it as `deferred to initiative end`. When this is the initiative's LAST plan to drain, run `lore assess <plan> [--diff <merge-base>..HEAD]` for EVERY plan of the initiative in parallel and triage all findings in one pass. Exception: a pilot plan that a pre-registered branch reads as its trigger is assessed as it closes. Exit 6 (AI provider error) → retry once, then report assess as skipped with the error; do not block completion on it.
4. **Final report**:
   ```
   **[AUTOPILOT DONE]** plan: {slug}
   Completed: {n} | Blocked: {n} ({slugs + reasons/holders}) | Skipped (claim conflicts): {n}
   Verify: {attested pass/fail per AC} | Assess: {verdict | deferred to initiative end | skipped}
   Worktrees: all merged + cleaned
   ```
   ⛔ **Every shared-state claim in the report must be derived from queries run AFTER closure, in this same turn** — `lore ready`/`lore status`/`git worktree list` NOW, never from earlier-in-context tool output. This is a multi-session workspace: a `lore tree` snapshot from hours ago is another session's history, not current state (live incident 2026-07-27: a "Phase 3 has 3 open tasks" claim about a SIBLING plan was hours stale — that plan had been completed and archived by a parallel session). Mentioning OTHER plans' status is optional; if you do, query them fresh or say "as of {time of my last look}".

## Stop Conditions

- **DONE** — no ready tasks, none blocked → closure phase → report.
- **BLOCKED** — no ready tasks but some blocked and no Major Decision applies → report holders/reasons; user reads, is not interrupted mid-flight.
- **PAUSED** — a Major Decision (M1–M5) → AskUserQuestion with structured options.
- **HALT** — context >90% → emit a handoff summary (plan slug, completed/blocked slugs, next wave) so a fresh session resumes via `lore ready <plan>`; lore already holds all task state.

## Exit-code branching (lore CLI)

`0` ok · `2` usage/contradiction (fix the invocation, not the corpus) · `3` check failed · `4` validation/gate fail (read feeding pack) · `5` claim conflict (skip, never steal) · `6` AI provider error (retry once) · `7` verify needs command approval (inspect, then `--allow-new-commands`).

## Rules Summary

- ⛔ lore is the SSOT — claims/evidence/release happen through lore, by the implementer, from its worktree.
- ⛔ Evidence comes from oracle exit codes; `lore verify` attests script ACs — never self-report pass.
- ⛔ Never `--steal`, never `lore release --force` foreign fresh claims, never `LORE_GATE_BYPASS` — user say-so only (M2).
- ⛔ Overlapping or undeclared anchors → serialize; each concurrent agent is a separate attested run (identity comes from the agent integration).
- ⛔ Merge returned branches immediately; clean up merged worktrees; never leave orphans. Sweep every round with `lore territory --json` — act only on `mine`/`unowned`, never `foreign`, escalate `unmeasured` by name.
- ⛔ Do not stop between tasks; only M1–M5 escalate.
