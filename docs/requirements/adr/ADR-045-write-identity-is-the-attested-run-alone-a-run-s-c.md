---
id: ADR-045
type: adr
role: decision
title: "Write identity is the attested run alone; a run's claims end with the run"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [run-identity, claims]
parent: PRD-001
links:
  - {id: ADR-044, type: relates-to}
---
# Write identity is the attested run alone; a run's claims end with the run

## Context

`adr-run-identity-is-issued-by-lore-and-attested-by-the-harness` (slice 1, landed 2026-10-11) made the harness run the attested identity of a write, but its decision 6 kept two self-reported channels as a "claimed" label: the `--by` flag (43 option definitions across 31 CLI command files, plus an optional `by` argument on 18 MCP tools) and `$LORE_ACTOR` (to be removed after two weeks at ≥95% attestation). Its rejected alternative "remove `--by` outright" was rejected on one number: 851 subagent write commands passed it (X1). That number came from shipped prompts that told agents to pass `--by`; slice 1 decision 7 removed those prompts.

Measured after slice 1 (session e25636da, 2026-10-11):

- `$LORE_ACTOR` still outranks the session tier in `packages/core/src/actor-resolution-node.ts:96`. A terminal that inherited a stale export attributed a whole session's writes to `agent:task-retraction` (handoff knowledge-handoff-agent-session-21d0be70-2, KD5).
- The claimed name is still a decision input in three places: `lore done`'s holder check (`task-workflow-service.ts:3242`, `claim.by !== opts.by`), `lore ready` session overlap (`:4103-4106`), and `hasClaimConflict` when either side is legacy or both are unattested (`packages/core/src/run-identity.ts:153-160`).
- A run has no end. The `runs` table (`migration-016.ts:42-53`) has no end column, `RunService` has only `register`/`show`, and no SessionEnd hook is registered. A claim outlives its run until `lore release` or the 120-minute TTL (`claim_ttl_minutes`, `config.ts:408`).
- Claude Code documents `SessionEnd` ("when a session terminates", reasons `clear | resume | logout | prompt_input_exit | other`, no decision control, shared 1.5 s budget raisable to 60 s via per-hook `timeout`) and `SubagentStop` ("when a subagent finishes"). It makes no statement about hooks on crash or kill. Source: https://code.claude.com/docs/en/hooks.

## Decision

Supersedes decision 6 of `adr-run-identity-is-issued-by-lore-and-attested-by-the-harness`. Every other decision of that ADR stands.

1. **`$LORE_ACTOR` is removed from the binary now**, not after the two-week window. Reason: it never contributes attestation, so waiting buys nothing, and while it is read it overrides the session tier. Shipped text names only the current path and never the retired variable, not even as a prohibition (user decision U4 of the slice-1 ADR).
2. **`--by` is removed from every write command and the `by` argument from every MCP write tool.** The identity of a write is the attested run. Without a harness run, the identity is derived (session tier, then OS username) and the write is marked `unattested`. Read-side `--by` options that filter output (`lore list`, `lore ready`, `lore session list`, and similar) stay: they select, they do not identify. Recording on behalf of another actor is dropped. ⚠️ Unvalidated: no post-slice-1 count of on-behalf writes exists. Ordering: the measurement comes BEFORE the removal. Every write since the slice-1 rollout (2026-10-11T11:42Z) already records both the attested run and the claimed name, so the measurement reads the existing audit log for claimed names that differ from the run's derived identity. It needs no transitional phase. The removal task depends on the measurement task, and a non-zero count reopens this item before any removal lands.
3. **Claim ownership is decided by run alone.** `hasClaimConflict` compares runs. For two unattested parties it compares their derived identities, which is the only case where a name decides. `lore done`'s holder check and `lore ready`'s overlap test switch from `by` to run.
4. **A run ends, and its claims end with it.** `runs` gains `ended_at` and `end_reason`. A new `lore run end` verb marks the run ended and releases every claim it holds. A `SessionEnd` hook ends the main run and a `SubagentStop` hook ends a subagent run. Each registration declares an explicit `timeout`, because the default 1.5 s budget is shared. A claim whose recorded worktree has uncommitted changes is NOT released: the run still ends, and the claim is marked `orphaned_dirty`. This mirrors the existing commit-before-attest refusal on `lore release`. Resolution reuses existing verbs and needs no new one. If someone commits or discards the work, the worktree becomes clean, and decision 5 then treats the claim as stale. Otherwise another run takes it over with `lore claim --steal`, the existing audited escape, whose output names the dirty worktree it inherits.
5. **TTL stays as the crash and kill fallback.** No hook is documented to fire on crash or kill. A claim whose run is `ended` AND whose recorded worktree is clean counts as stale immediately. An `orphaned_dirty` claim is exempt from both immediate staleness and TTL expiry, and only `--steal` or a clean worktree ends it (decision 4). A claim whose run never ended expires on `claim_ttl_minutes` as today.

## Success and rollback

- Outcome: zero writes resolve identity from `$LORE_ACTOR` or `--by`, measured as audit rows whose identity source is `env` or `explicit` (counted by `lore status --json`). Median claim lifetime after its run ends, excluding `orphaned_dirty` claims: under 1 minute, versus up to 120 minutes today. `orphaned_dirty` claims are counted separately, together with their age.
- Rollback: if a non-harness caller (CI, a human CLI) loses a workflow it depended on, restore `--by` as a claimed-only label on that one command, with the count that justified it.

## Alternatives rejected

- **Keep `--by` as a claimed-only label (status quo, decision 6).** The label still feeds three decisions (Context, bullet 2), and its only measured user base (X1) no longer exists.
- **Release claims on `Stop` instead of `SessionEnd`.** `Stop` fires at the end of every turn, not when the run ends. A main agent that holds a claim across turns would lose it.
- **Rely on TTL alone.** That is the status quo. It leaves a dead run's task unclaimable for up to 120 minutes.

## Consequences

- Positive: one identity source per write, so no self-reported name can decide a claim, a done, or an overlap. A run's tasks become claimable as soon as the run ends.
- Negative: non-harness callers lose an explicit identity override. Each SessionEnd and SubagentStop now runs a `lore` subprocess. Two unattested processes under the same OS user with no session tier derive the same identity, so they count as one claim owner and see no conflict with each other.
- Unvalidated: whether `SubagentStop` fires for background subagents, and whether a session resumed after `clear`/`resume` gets a new `session_id` (and therefore a new run). The spec MUST verify both against the docs or a live probe before any AC depends on them.
