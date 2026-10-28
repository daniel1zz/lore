---
id: ADR-044
type: adr
role: decision
title: "Run identity is issued by lore and attested by the harness; self-reported actor names become a claimed label"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-28
tags: [identity, actor, claim, attestation]
parent: PRD-001
links:
  - {id: KN-589, type: implements}
  - {id: KN-588, type: implements}
  - {id: KN-590, type: implements}
  - {id: BASE-021, type: informs}
  - {id: BASE-027, type: informs}
  - {id: SPEC-025, type: informs}
  - {id: PLAN-162, type: informs}
---
# Run identity is issued by lore and attested by the harness; self-reported actor names become a claimed label

Status: the threat model was settled by U1 (cooperative agents); the lifecycle status is whatever `lore get` shows — this text does not assert it.

**Wording settled downstream (read this before the decisions below):** the spec names the stored field `harness_run` (code) while every user-facing label keeps `attested: … · claimed: …` (spec D9 — `attested_run` collided in search with the existing `attestation.runner`). "Issued by lore" means the run is *registered* by lore under an id derived from the harness's own ids (spec D2), not a random id minted by lore. "Claimed" is the name lore already resolves today (flag, environment setting, tool argument, session, working copy or computer user name) stored with its source (spec D11); only attestation is new.

Evidence chain: `knowledge-agent-identity-as-a-lore-concept-fix-identity-keep` (ideation) → `knowledge-attributable-writes-opportunity-solution-tree` (OST, branch O2 selected) → `knowledge-agent-identity-validation-ledger` (rounds 1–2, every experiment with pre-registered kill lines). Numbers below are copied from those documents, not re-asserted.

## Context

Lore has no agent entity. Attribution of every write (`by`, `recorded_by`, `audit.actor`) is a self-reported string resolved per invocation: `--by` > `$LORE_ACTOR` > session tier (`agent:session-<8>`) > worktree-derived `agent:<branch>` > OS username.

Measured:
- 806 of 806 evidence rows in the last 30 days were attributed by `--by` or `$LORE_ACTOR`; the session tier was never reached (ledger X2).
- 70.2% of 2,908 lore writes in 30 days were issued by subagents (X1); a session and all its subagents share one `session_id` (F3), so nothing recorded today separates concurrent subagents.
- Same-task takeovers of a fresh lease by a different session are treated as a refresh and leave no trace (2 cases on 2026-08-11, V1; `baseline-claim-a-task` BR-125, open question Q2).
- The identity carrier is an OS environment variable with no isolation: a stale `export LORE_ACTOR=…` in a shell profile attributed every session's and subagent's writes to one name.
- With today's log format, 3 of 3 fresh agents accused the named actor of a change; with `attested: unattested · claimed: …`, 0 of 3 did (X3b).

Claude Code hands hooks a stable, distinct per-subagent `agent_id` at SubagentStart and on every PreToolUse inside that subagent, none on the main thread, and a PreToolUse `updatedInput` rewrite is what actually runs — on Bash (F1–F3) and on `mcp__lore__*` calls (X4).

## Decision

1. **Run identity, issued by lore.** Each execution run — a main session or one subagent — is registered by lore and given a run id, with its type, harness reference (`session_id`, `agent_id`), parent run (lineage) and branch. Runs live in an append-only store table, not as corpus documents; local paths (worktree) stay out of the corpus (SPEC-025 non-goal).
2. **Attested by the harness, never self-reported.** A harness adapter proves which run an invocation belongs to. For Claude Code: SessionStart registers the main run, SubagentStart registers a subagent run, PreToolUse (Bash and `mcp__lore__*`) injects the run into that single call via `updatedInput`, overwriting any value the caller supplied. Per-invocation, never through an environment variable. *Amended 2026-10-28: the `mcp__lore__*` half no longer exists; the lore MCP server was deleted on 2026-10-27 (`adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only`), so PreToolUse attests Bash calls only.*
3. **Two attribution fields on every write.** `attested_run` (from the adapter; absent when no adapter vouched) and `claimed` (from `--by` / `$LORE_ACTOR`, if any). Every surface prints `attested: <run | unattested> · claimed: <name>`. A write without attestation is labelled `unattested` — never guessed, never back-filled from the OS username.
4. **Claims conflict by run.** On the same task, a fresh claim held by another attested run is a conflict requiring `--steal`, recorded as a takeover; an unattested claimant against an attested holder is a conflict too. Replaces BR-125's "same `by` = same holder" and answers CLAM Q2.
5. **"The agent" is derived, never stored.** Views over runs (by type/template, later by composition) are computed, consistent with sessions (SPEC-042 D1) and readiness. Not part of the first slice.
6. **Self-reported identity is retired as an identity source.**
   > **SUPERSEDED 2026-10-11** by `adr-write-identity-is-the-attested-run-alone-a-run-s-claims-end` (its Decision 1-3): `$LORE_ACTOR` is removed now, without the two-week window. `--by` is removed from every write command, and the MCP `by` argument from every write tool. Read-side `--by` filters stay. The bullets below are kept as the historical record of this decision and are no longer in force.
   - `$LORE_ACTOR`: first slice reads it only as `claimed` and warns once per process that it is deprecated; it is removed from the binary after two weeks at ≥95% attestation with no remaining dependent caller.
   - `--by`: kept, optional, `claimed` only. Remaining legitimate uses: callers with no adapter (a human on the CLI), recording on behalf of someone (`attested` = the run that executed, `claimed` = who it was for), and read-side filters (`lore feed session-resume --by`, `lore bootstrap --by`), which should move to run/lineage filters later.
   - MCP: the 18 tools that require `by` (`z.string().min(1)`) make it optional — requiring it forces agents to invent a name. *(Moot since 2026-10-27: the MCP tools were deleted, `adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only`.)*
7. **Text that tells agents to set identity is removed in the SAME slice as the adapter ships** — never before, or agents fall back to the session tier, which a session's subagents share. Surfaces: user context fragments `user-04`, `user-17`; `assets/agents/lore-implementer.md`; skills `lore-autopilot`, `lore-plan` (workflow examples, mode-update, phase-decomposition), `lore`, `shared/lore-cli-map`, `lore-session-review` (invariants check "distinct LORE_ACTOR" → "writes carry an attested run"), `lore-session-capture`; `assets/governance/seat-briefing.md` (`export LORE_ACTOR={{ACTOR}}`); root `CLAUDE.md`; `assets/context/corpus-workflow-3-execute.md` → `.claude/rules/lore-corpus-workflow-execute.md`. Unregistered dead file: `~/.claude/hooks/pre-task-lore-dispatch-gate.mjs`.
8. **History is not rewritten.** The 5,657 existing evidence rows and all earlier writes read as `attested: unattested`, their stored name shown as `claimed`.

## Success and rollback

- Outcome: share of claim + evidence + handoff writes carrying an attested run, 0% → ≥95% over two weeks after rollout.
- Guardrails: zero silent same-task takeovers; zero run ids shared by two subagents.
- Rollback trigger: attestation <80% after rollout means callers bypass the adapter (script files, `bash -c`); identify the paths and widen matching. ("Refuse unattested writes" was considered and rejected by the user — U2.)

## Alternatives rejected (with the number that rejected them)

- **Session-id-only claim conflicts** — a session and its subagents share one `session_id` (F3: 3 of 3 hook inputs in one run). Note: both measured takeovers were cross-session, which this would have caught; it cannot see subagent concurrency at all.
- **Subagents never write; the main thread writes for them** — 70.2% of writes are subagents' (X1).
- **Remove `--by` outright** — 851 current subagent write commands pass it (X1); reshaped into decision 6.
- **Keep identity in OS environment variables (`$LORE_ACTOR`, or per-agent exports)** — no isolation: inherited by every child process, settable by any profile line, untraceable; observed leaking into all sessions.
- **Persistent individual agents (named employees with private memory)** — not tested; set aside by the user's judgement that fixing composition ex ante constrains AI execution. Not refuted.
- **Lore launches every run itself (`lore run`)** — would turn lore into an agent runtime; exposed the constraint that only the launcher can prove a run, hence attestation lives at the hook layer.

## Threat model (decided — U1)

A same-user process can read whatever the hook can (a signing key, lore's own store), so no design resists a deliberately malicious agent without OS-level read restrictions on Bash. Recommended: design for **cooperative but error-prone agents** — the only failure class observed — where unconditional overwrite by the hook suffices and unmatched paths are labelled `unattested`. Upgrade path if adversarial agents must be resisted: short-lived signed run tokens (OST O2-S5) plus a sandbox deny-read on the key path. Decided by the user as U1 (cooperative agents). Accepted residual risks: a caller outside the hook's sight (script file, direct HTTP/MCP client) can supply a registered run id and is believed; a failed `lore run attest-input` leaves the command unrewritten, so a caller-written `--harness-run` is not stripped on that call.

## Consequences

- Positive: attribution stops lying (labels are honest even before coverage is complete); claims regain SPEC-025's purpose; dispatch bundles no longer carry identity boilerplate; a base exists for lineage (OST O3) and setup comparison (O4).
- Negative: identity now depends on a harness adapter; non-Claude-Code callers produce `unattested` writes until they get one (⚠️ unvalidated); every write path gains an `attested_run` field; the deprecation of `$LORE_ACTOR` touches ~15 shipped text surfaces in one slice.
- Unvalidated as a combination: the parts are individually validated (F1–F3, X2, X3b, X4, V1); reaching ≥95% end to end is measurable only after rollout.

## Baseline impact (to be written before any spec)

- `baseline-claim-a-task`: BR-125 changes (same-task conflict by run); Q2 answered; BR-131/BR-134/BR-135 revisited (identity sharing becomes visible as `unattested` rather than refused by name).
- New identity leaf under the session branch (CLAM lists "session (not yet written): identity resolution" as a dependency): registration, attestation, labelling, deprecation of self-reported identity.

## Decisions by user (S1 decision interview, 2026-10-11)

| # | Question | Decided |
|---|---|---|
| U1 | Threat model | **Cooperative but error-prone agents.** Hook overwrites the identity argument unconditionally; paths the hook does not see are labelled `unattested`. Signed tokens (OST O2-S5) are out of scope until an adversarial requirement appears. Resolves §Open decision. |
| U2 | Pre-registered branch: attestation <80% after rollout | **Find the bypassing paths and widen matching**; those writes stay `unattested` and are NOT refused. (Rejected: refuse unattested writes on agent surfaces.) |
| U3 | Stale shell-profile identity | Done 2026-10-11: `~/.zshrc` backed up to `~/.zshrc.bak-2026-10-11-lore-actor`; the `export WT=…` and `export LORE_ACTOR=agent:task-retraction` lines removed; a missing newline that glued `LANGFUSE_SECRET_KEY` to the next `export PATH` restored. Verified in a fresh `zsh -i`: both variables unset. |
| U4 | Execution scope | Full chain to implementation under batched governance: decompose → baseline rules → spec → plan → one bundle review → one user approval → implementation. |
| U5 | Role templates (frontend/backend/full-stack) with role-bound and context-bound norms and capabilities | **Separate initiative** (`knowledge-role-templates-with-role-bound-and-context-bound`). Slice 1 of this ADR additionally records, per run, the role/agent type and the injected fragment ids with content hashes — nothing else from that initiative enters slice 1. |
