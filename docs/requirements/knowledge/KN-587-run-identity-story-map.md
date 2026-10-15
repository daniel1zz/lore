---
id: KN-587
type: knowledge
role: knowledge
title: "Run identity — Story Map"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [identity, story-map]
parent: PRD-001
links:
  - {id: KN-589, type: implements}
  - {id: ADR-044, type: implements}
  - {id: KN-588, type: relates-to}
---
# Run identity — Story Map

`/lore-product decompose`, 2026-10-11, of the reshaped bet validated in `knowledge-agent-identity-validation-ledger` round 2 (OST `knowledge-attributable-writes-opportunity-solution-tree` branch O2: O2-S2 hook-attested run id + O2-S4 attested/claimed labels), as decided in `adr-run-identity-is-issued-by-lore-and-attested-by-the-harness` (U1 cooperative threat model, U2 <80% → widen matching, U5 record composition in slice 1).

Actors: **run** (a main session or one subagent doing the work), **orchestrator** (a main session that dispatches and merges), **reader** (an agent or human reading history), **unattested caller** (a human on the CLI, a script, any call no adapter vouches for).

Validation tags: ✅ = covered by a named experiment; ⚠️ = derived from the map, never tested. Unhappy-path rows are ⚠️ unless an experiment covered them.

## Backbone (the journey as it will be, unchanged steps included)

```
B1 Start working → B2 Pick up a task → B3 Record what I did → B4 Hand over or finish → B5 Find out who did something → B6 Take over a task
```

## Map

### B1 Start working

| # | Task | Kind | Validation |
|---|---|---|---|
| B1.1 | A main session gets a run when it starts | happy | ✅ F3 (main thread identifiable: no `agent_id`, own `session_id`) |
| B1.2 | A dispatched subagent gets its own run, parent = the dispatching run | happy | ✅ F1 (distinct stable `agent_id` at SubagentStart) |
| B1.3 | The run records its agent type and the injected fragment ids with content hashes | happy | ⚠️ U5 — derived |
| B1.4 | Resume / `--continue` / `/compact` re-fires SessionStart: the same session keeps the same run (first registration wins) | leave & return | ⚠️ |
| B1.5 | Adapter not installed, or `lore` missing on PATH: the session still starts; its writes become `unattested` and the start injection says so once | fails | ⚠️ |
| B1.6 | Registration itself fails (store busy/unavailable): never blocks the session; the run is absent, so writes label `unattested`; the failure is reported, not swallowed | fails | ⚠️ |
| B1.7 | First run on a corpus created before this feature: the run store is created on first use | nothing yet | ⚠️ |
| B1.8 | Many parallel subagents (6 concurrent here): each gets a distinct run | too much | ✅ F1 (2 parallel, distinct) — scale ⚠️ |

### B2 Pick up a task (claim)

| # | Task | Kind | Validation |
|---|---|---|---|
| B2.1 | The claim records the attested run | happy | ✅ F2 (injection reaches the call) |
| B2.2 | The same task, freshly held by another attested run: refused as a conflict; `--steal` required | happy | ✅ V1 (2 silent takeovers this prevents) |
| B2.3 | The same run claims again: lease refreshed | happy | existing behaviour |
| B2.4 | An unattested claimant against an attested holder: conflict | fails | ⚠️ |
| B2.5 | A claim made before rollout (no run) is still fresh: compared by the stored name, as today, until it is released or goes stale | nothing yet (transition) | ⚠️ |
| B2.6 | A human on the CLI claims: allowed, recorded `unattested` with the given name as `claimed` | unattested caller | ⚠️ |

### B3 Record what I did (evidence, AC, documents, links, rules)

| # | Task | Kind | Validation |
|---|---|---|---|
| B3.1 | Every write stores `attested_run` (from the adapter) and `claimed` (from `--by` / `$LORE_ACTOR`) | happy | ✅ X2 (root cause), F1–F3 |
| B3.2 | `--by` given: stored as `claimed` only, never as attestation | happy | ✅ X1/X2 (851 subagent commands still pass it — must not break) |
| B3.3 | `$LORE_ACTOR` set: stored as `claimed`; one deprecation warning per process | happy | ⚠️ |
| B3.4 | An MCP write is attested the same way as Bash; MCP `by` becomes optional on the 18 tools that require it | happy | ✅ X4 (attestation); ⚠️ (optional `by`) |
| B3.5 | A call the adapter does not see (script file, `bash -c` built at runtime): stored `unattested` — never guessed | fails | ✅ F5 (such paths exist) — handling ⚠️ |
| B3.6 | The injected run id is unknown to the run store (registration lost): stored `unattested`, warned, write not refused | fails | ⚠️ U1 |
| B3.7 | A batch write (`lore batch`): every operation carries the same attestation | too much | ⚠️ |

### B4 Hand over or finish

| # | Task | Kind | Validation |
|---|---|---|---|
| B4.1 | Release by the holding run; release by another run still needs `--force`, recorded | happy | existing semantics, now by run ⚠️ |
| B4.2 | The orchestrator archives (`lore done`) after merge: attested = the orchestrator's run; `claimed` may name who it acts for | happy | ⚠️ |
| B4.3 | A handoff records its attested run | happy | ⚠️ |

### B5 Find out who did something

| # | Task | Kind | Validation |
|---|---|---|---|
| B5.1 | `lore get`, `lore log`, evidence listings and their JSON print `attested: <run \| unattested> · claimed: <name>` | happy | ✅ X3b (0/3 vs control 3/3) |
| B5.2 | The `created by system` false label disappears: the same write shows the same author everywhere | happy | ✅ value (defect `task-lore-create-by-is-accepted-and-ignored-cli-content-writes`) |
| B5.3 | Every write made before rollout reads `unattested`, its stored name shown as `claimed` | nothing yet | ⚠️ decision 8 |
| B5.4 | A run id shown in a label resolves: `lore run show <id>` prints type, parent run, session, branch, fragments | fails (unaddressable label) | ⚠️ — required by "every assertion addressable" |
| B5.5 | The attestation share over a window is reported (`lore status --json` field) so the outcome (≥95%) and the U2 trigger (<80%) are measurable | measurement | ⚠️ |

### B6 Take over a task

| # | Task | Kind | Validation |
|---|---|---|---|
| B6.1 | `--steal` records a takeover naming the previous run and the new one | happy | existing steal record, now by run ⚠️ |

### Cross-step (ships in the same slice — ADR decision 7)

| # | Task | Validation |
|---|---|---|
| X.1 | Every shipped text that tells agents to set identity is rewritten in the same slice: user fragments `user-04`, `user-17`; `assets/agents/lore-implementer.md`; skills `lore-autopilot`, `lore-plan` (workflow-examples, mode-update, phase-decomposition), `lore`, `shared/lore-cli-map`, `lore-session-review` invariants, `lore-session-capture`; `assets/governance/seat-briefing.md`; root `CLAUDE.md`; `assets/context/corpus-workflow-3-execute.md` | ⚠️ |
| X.2 | The Claude Code adapter hooks ship through `lore setup` like every other hook (fresh-install reachable) | ⚠️ |

## Slice

**Above the line (slice 1):** B1.1–B1.8, B2.1–B2.6, B3.1–B3.7, B4.1–B4.3, B5.1–B5.5, B6.1, X.1, X.2. It walks the whole backbone: a run starts with an identity, claims, records, finishes, can be found by a reader, and can be taken over visibly.

**Below the line (next slices, kept so they are not rediscovered as "new requirements"):**

| Row | Why below |
|---|---|
| Show holder liveness at claim time (OST O1-S4) | O1 is the Alternative branch; not needed for attribution |
| Fencing token per claim (O1-S5) | O1 branch; ~1 week |
| Re-key handoff supersession on run lineage instead of (plan, actor) (2026-07-31 incident) | behaviour change of its own; needs slice 1's runs first |
| Session-start marker and handoff coverage authorship read from runs | same |
| Run listing / lineage queries; read-side filters (`feed --by`, `bootstrap --by`) by run | not needed to attribute a write |
| Run-store retention | no volume measured yet |
| Lineage deeper than one level (nested subagents) | spawn depth is 1 in this environment |
| Adapters for other harnesses (Codex, HTTP key → run) | ⚠️ unvalidated; they label `unattested` meanwhile |
| Signed run tokens (O2-S5) | out of scope under U1 |
| Remove the `$LORE_ACTOR` read from the binary | after two weeks at ≥95% (ADR decision 6) |
| `audit.session_id` / `trace_events.session_id` hold non-session values | separate defect — file it, do not fix in this slice |
| `attested · claimed` labels on feed, session snapshot, list and status | BR-1037 was narrowed to the document view and the version history at the S3 review; the other surfaces keep today's rendering |
| Derived agent views; role templates; context-bound selection | `knowledge-role-templates-with-role-bound-and-context-bound` (U5) |

## Requirements read off the map (slice 1)

| Req | From | Requirement | source | validation |
|---|---|---|---|---|
| R1 | B1.1, B1.2, B1.8 | Each main session and each subagent is registered as a distinct run with its parent run | O2-S2 | ✅ F1, F3 |
| R2 | B1.3 | A run records its agent type and injected fragment ids + content hashes | U5 | ⚠️ unvalidated |
| R3 | B1.4 | Re-registration of the same session is idempotent (first wins) | map B1 | ⚠️ unvalidated |
| R4 | B1.5, B1.6 | Missing adapter or failed registration never blocks a session; writes label `unattested`; the condition is reported once | map B1 | ⚠️ unvalidated |
| R5 | B1.7 | The run store is created on first use on an existing corpus | map B1 | ⚠️ unvalidated |
| R6 | B2.1, B3.1, B4.3 | Every write (claims, evidence, AC, documents, links, rules, handoffs) stores `attested_run` and `claimed` | O2-S2 + O2-S4 | ✅ X2, F1–F3 |
| R7 | B3.2, B3.3, B2.6 | `--by` and `$LORE_ACTOR` only ever populate `claimed`; `$LORE_ACTOR` warns once per process as deprecated | O2-S4 (reshaped O2-S1) | ✅ X1/X2 for `--by`; ⚠️ warning |
| R8 | B3.4 | `mcp__lore__*` writes are attested; MCP `by` is optional | O2-S2 | ✅ X4; ⚠️ optional `by` |
| R9 | B3.5, B3.6 | A write with no or unknown attestation is stored `unattested` and never refused or guessed | U1, U2 | ⚠️ unvalidated |
| R10 | B3.7 | Batch writes carry one attestation per operation | map B3 | ⚠️ unvalidated |
| R11 | B2.2, B2.4, B6.1 | Same-task claim conflict is decided by run: another attested holder or an unattested claimant against an attested holder → conflict; `--steal` records the takeover with both runs | V1 | ✅ V1 (value); ⚠️ unattested-vs-attested |
| R12 | B2.5 | Claims made before rollout are compared by stored name until released or stale | map B2 (transition) | ⚠️ unvalidated |
| R13 | B4.1, B4.2 | Release and archive record the acting run; release by a non-holder still needs `--force` | map B4 | ⚠️ unvalidated |
| R14 | B5.1, B5.2, B5.3 | Every read surface prints `attested: <run \| unattested> · claimed: <name>`; one author per write on every surface; pre-rollout writes read `unattested` | O2-S4 | ✅ X3b; ⚠️ history rendering |
| R15 | B5.4 | `lore run show <id>` resolves any run id a label prints | North Star "addressable" | ⚠️ unvalidated |
| R16 | B5.5 | `lore status --json` reports the attestation share over a window | outcome metric, U2 | ⚠️ unvalidated |
| R17 | X.1 | Shipped instructions to set identity are removed in the same slice | ADR decision 7 | ⚠️ unvalidated |
| R18 | X.2 | The adapter hooks are installed by `lore setup` and verified from a fresh consumer install | root CLAUDE.md distribution rule | ⚠️ unvalidated |

P0 candidates with value `⚠️ unvalidated` (R2–R5, R9, R12, R15–R18) are mechanics or transitions of a validated bet rather than new value bets; per mode-validate's gate each still needs a validation task in the plan or an explicit `🎲 accepted bet` at S4.

## Cross-cutting concerns

- Privacy: a run stores `session_id`, `agent_id`, agent type, branch and fragment hashes — never `transcript_path`, never a local worktree path in the corpus (SPEC-025).
- Fail-loud vs fail-open: registration failure must not block work (B1.6), and it must not be silent either — the `unattested` label plus a one-time report is the loud signal.
- Accountability: takeover stays possible for humans (`--steal`) and becomes visible.

## Assumptions and confidence

| Assumption | Confidence |
|---|---|
| The six backbone steps cover every write a run makes | MEDIUM — derived from X1's verb counts (evidence 567, claim 371, rule 311, set 268, ac 240, baseline 215, …) |
| Idempotent re-registration keyed on session works across resume/compact | LOW — not measured |
| Transitional rule R12 does not strand in-flight claims at rollout | MEDIUM |
