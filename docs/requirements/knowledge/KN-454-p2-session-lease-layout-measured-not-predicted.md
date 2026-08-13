---
id: KN-454
type: knowledge
role: knowledge
title: "P2 session-lease layout, measured not predicted: taskClaimSchema's three capture policies, the single heartbeat call site, and the four decisions P2 must make"
status: approved
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: SPEC-142
---
# P2 session-lease layout, as MEASURED on main @9736bdb9 (2026-08-13)

Written because the P1 handoff (NS5) required the P2 layout to be **measured before any
L1/L2 structured AC is declared**, never predicted. Everything below is read off the
source at the commit named above. No proposal here is an AC; the AC set is P2's to
declare once it decides among the options this document leaves open.

## 1. The claim record today — `taskClaimSchema`

`packages/core/src/task-workflow.ts:590`. Six fields, and the capture policy differs
per field in ways P2 must not flatten:

| Field | Required | Capture policy, verbatim from the schema's own comments |
|---|---|---|
| `by` | yes | actor string, `min(1)` |
| `at` | yes | timestamp string |
| `branch` | no | — |
| `machine` | no | "Auto-captured by the CLI as `os.hostname()`; explicit-only over MCP (SPEC-042 D2)" |
| `worktree` | no | "ALWAYS explicit — never auto-captured from `process.cwd()` (SPEC-042 D2, review U2)" |
| `session_id` | no | sanitized discriminator of `$CLAUDE_CODE_SESSION_ID`/`$CLAUDE_SESSION_ID`, "captured at claim time by `TaskWorkflowService.claim` for EVERY caller with no flag or opt-in". Absent ⇒ "this claim's session was never measured … NOT 'the same session as yours'" |

⛔ Three different policies coexist here — auto-with-MCP-exception (`machine`),
never-auto (`worktree`), always-auto (`session_id`). A pid field is closest in kind to
`machine` (a probe of the running process, not a path the caller could mean differently),
but P2 must make that call explicitly rather than inherit whichever neighbour it copies.

## 2. Where liveness comes from today — and why it is unmeasured for peers

- `SessionService.recordOwnHeartbeat(sessionId, pid, machine, now?)` is documented as
  "AC-OWN-5's ONLY write": it records "THIS process's OS-probed `{pid, started_at}`"
  as that session's current heartbeat. It is a COMMAND, never hidden in a query (CQS).
- Its target is a **tmpdir sidecar file behind `writeHeartbeatPort`** — explicitly
  "never a corpus document". `SessionService`'s `@invariant` block states `bootstrap`,
  `resume`, `getActiveSessions` and `deriveSessionLiveness` perform ZERO store
  mutations, and that `recordOwnHeartbeat` is "the ONE exception" — yet even it writes
  nowhere near the store.
- **There is exactly ONE call site**: `packages/lore/src/adapters/cli/commands/session.ts:149`,
  reached only inside `lore session list` / `lore session show`, and skipped entirely
  when `resolveClaimSessionId(process.env)` yields nothing (MCP/HTTP callers with no
  `CLAUDE_CODE_SESSION_ID`).

⇒ The measured consequence, which is the whole reason P2 exists: **a peer session that
never ran `lore session list|show` has no heartbeat at all**, so it is `unmeasured`
forever. That is not a bug in the verdict logic — it is the absence of a write.

## 3. Why the pid recorded is `process.ppid`, and why that was correct for P1

The call site's own comment (`session.ts:134-146`) already records the reasoning, and it
should not be re-litigated from scratch in P2:

- It records `process.ppid` — "the parent that invoked THIS `lore` binary — the
  orchestrating shell/agent process" — **never** `process.pid`, because "the `lore` CLI
  process itself is a short-lived subprocess that exits the instant this command
  returns, so recording ITS OWN pid would make every session report 'dead' on the very
  next probe, moments after reporting 'alive' (measured while building this command)".
- It concedes the limit in the same breath: `process.ppid` is "still an approximation of
  'the orchestrator'", and "full orchestrator-pid capture is P2's session-lease
  mechanism, out of this plan".

So `process.ppid` is a deliberate, documented floor — "measurably better than the CLI's
own pid" — not an oversight. P2 replaces it; P2 does not correct it.

## 4. What P2 has to decide (open, deliberately unanswered here)

1. **Write site.** Capturing orchestrator identity at `TaskClaim` time makes it durable
   and visible to peers that never run a session command — the defect in §2. But the
   claim record is a corpus document, and today the heartbeat is deliberately kept OUT
   of the store. Moving it in crosses that line; keeping it out leaves peers unmeasured.
2. **Which pid.** `process.ppid` at claim time has the same approximation problem as at
   `session list` time. An orchestrator that spawns `lore` through an intermediate shell
   yields that shell's pid, not the agent's.
3. **Start time.** `{pid, started_at}` is already the probed pair, so start-time capture
   is not new work — but its SOURCE at claim time must be the same OS probe, not a
   wall-clock read at claim time, or the mismatch check becomes vacuous.
4. **Capture policy** per §1: auto, auto-with-MCP-exception, or always-explicit.

⛔ Do not declare L1/L2 structured ACs against any of the four above until the option is
chosen and measured on a real two-session run. The P1 handoff was explicit that
predicting this layout is the failure mode to avoid.

## 5. Corroborating governance state at time of writing

`AC-OWN-5`'s statement was narrowed this session (spec v26 → re-approved v27) to say
"a probed process identity (pid plus process start time)" rather than "the orchestrator
pid", and to record both consequences above. The `lore review` judge independently
flagged the residue as an advisory: the criterion "asserts nothing checkable about when
'unmeasured' must be emitted versus 'dead'". That distinction is P2's to pin.
