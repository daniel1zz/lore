---
id: KN-589
type: knowledge
role: knowledge
title: "Agent identity — Validation Ledger"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [identity, actor, claim, validation]
parent: PRD-001
links:
  - {id: KN-590, type: implements}
  - {id: BASE-021, type: informs}
  - {id: TASK-384, type: informs}
  - {id: KN-588, type: relates-to}
---
# Agent identity — Validation Ledger

`/lore-product validate` run on 2026-10-11 against `knowledge-agent-identity-as-a-lore-concept-fix-identity-keep`.
Kill lines were written to a scratch pre-registration file at 2026-10-11T06:53:35Z, BEFORE any experiment below, and are reproduced verbatim in §Pre-registration. They were set by the AI, not approved by the user (see Gaps).

Users of this capability are the AI agents executing on the corpus and the maintainer who reads its attribution. All evidence below is E1 (observed behaviour or instrumented data from this repository's own store, git and hook payloads) unless marked otherwise.

## Gaps in this run (read first)

- **No opportunity tree (round 1 only).** Round 1 skipped `opportunity`; its S1–S4 came from a design discussion. Closed afterwards: `knowledge-attributable-writes-opportunity-solution-tree` derived 24 solutions over 4 opportunities and selected O2; round 2 below validates that branch.
- **Kill lines were not user-approved.** Batched governance fixes bars with the user; here they were AI-set and frozen by timestamp only.
- **One repository, one team.** Every measurement is from the lore repo itself (dogfooding). Nothing here shows the problem exists for another team.

## Part A — Problem score

| Dimension | Score | Evidence | Tier |
|---|---|---|---|
| Frequency | 4 | Collapse is structural, not occasional: 1,789 of 5,657 task evidence rows (32%) sit under one literal `agent:main-orchestrator`; that actor's claims came from 5 distinct sessions; every subagent of a session carries the parent's `session_id` (spike F3). Harm-producing events: 2026-07-31 (live handoff archived), 2026-08-02 (live agent worktree removed, twice), 2026-08-03 (permanent phase-claim refusal), 2026-08-11 (2 silent same-task takeovers, §V1), 2026-10-11 (all writes of every session attributed to a stale shell-profile `LORE_ACTOR`) — about 7 events in ~10 weeks, i.e. closer to weekly than monthly. | E1 |
| Intensity | 4 | Worst cases destroyed state another session depended on (a live worktree; a live resume ticket). The rest corrupt attribution silently, which no later reader can repair. | E1 |
| Workarounds | 5 | Custom tooling already built around the gap: the `LORE_ACTOR` export discipline in user rules and dispatch bundles; SPEC-104 worktree-derived actor; the claim-time actor-identity guard spec; `session_id` capture on task claims, then again on phase claims; a tmpdir session-start marker file so `lore feed` can tell "this session" apart. | E3 |
| Willingness to pay | 4 | Internal tool, so no money changes hands. Measured instead as effort already spent on partial solutions (the Workarounds row: ≥3 specs and ≥3 tasks). Scored 4, not 5, because effort is not money and the effort was spent by the same team that wants the feature. | E3 (proxy) |

**4 × 4 × 5 × 4 = 320 → strong signal, proceed.** Weakest dimension: Frequency. At Frequency 3 the score is 240 (promising); the verdict to proceed holds either way, but the problem is proven for this repository only.

## Assumption map

| # | Assumption | Importance | Evidence before this run | Order | Status after this run |
|---|---|---|---|---|---|
| A1 | The harness can attest a distinct identity per subagent and get it into each call | High — if false, S3 is impossible | None | **1st** | ✅ tested (F1–F3) |
| A2 | Identity collapse defeats the claim's original purpose (SPEC-025 gap 3) in practice, not just in theory | High | Some (incident docs) | 2nd | ✅ tested (V1) |
| A3 | The change can be made at a chokepoint rather than at every writer | High — cost driver | None | 3rd | measured (viability) |
| A4 | Derived "agent" views (by template, by composition element) will actually drive decisions | High | None (stated wish only, E6) | not testable before build | ⚠️ unvalidated |
| A5 | MCP tool calls can be attested the same way | Medium | None | — | ⚠️ unvalidated (not run) |
| A6 | Non-Claude-Code callers (human CLI, HTTP key, Codex) can be attested | Medium | None | — | ⚠️ unvalidated (not run) |

## Pre-registration (verbatim, 2026-10-11T06:53:35Z)

- V1: KILL the "claims need run identity" premise if proven-concurrent (both leases fresh, no release between) same-task same-actor distinct-session pairs = 0 AND recorded identity-collapse incidents with state damage < 2. Otherwise PASS.
- F1: PASS only if the SubagentStart hook input AND a PreToolUse(Bash) input fired inside that subagent both carry a non-empty `agent_id`, and they are EQUAL.
- F2: PASS only if a PreToolUse `updatedInput` rewrite of a Bash command is the command that actually runs.
- F3: PASS only if the main thread's PreToolUse(Bash) input carries NO `agent_id`.
- F4, F5: observations, not kills (coexistence with other Bash hooks; whether the model sees the rewritten command).

## Experiments and results

### V1 — does identity collapse defeat claims? (corpus history)

Of 816 distinct claim states in version history, 351 carry `session_id` (captured since 2026-08-03). Same-task, same-actor, distinct-session pairs within the 120-minute lease: 3 tasks, all on 2026-08-11, sessions `355b9404` → `ad0fbe10`.

| Task | Old session released before takeover? | Verdict |
|---|---|---|
| `task-make-mirrorhumanid-a-nominal-type-on` | yes (v7, 11:49) | legitimate handover |
| `task-resolve-verifyfalsifier-s-execution-root-through-spec-063` | **no** — `355b9404` lease fresh (last write 11:58), `ad0fbe10` claimed 12:11 | silent takeover |
| `task-verify-assess-finding-paths-against-the-assessed-commit` | **no** — `355b9404` lease fresh (claimed 11:38), `ad0fbe10` claimed 12:12 | silent takeover |

**Result: 2 pairs meet the pre-registered condition; incidents with state damage ≥ 2 (07-31, 08-02). V1 PASS.**
Honest limit: `355b9404` never wrote again after 12:11, so it was most likely dead and `ad0fbe10` was resuming. Process-level concurrency is NOT proven. What IS proven: lore cannot tell a different session taking over from the holder refreshing, so a takeover — legitimate or not — leaves no trace and needs no `--steal` (BR-125).
Measurement blind spot: subagents share their parent's `session_id`, so this history cannot show concurrent subagents of one session at all. The true collision rate is therefore not measurable from today's data — itself evidence for A1.

### F1–F5 — can the harness attest per-subagent identity? (spike, throwaway project)

Setup: a throwaway git project under the session scratchpad with two project hooks — SubagentStart (log only) and PreToolUse(Bash) (log, and for commands containing a marker return `permissionDecision: allow` + `updatedInput` replacing the command with `echo REWRITTEN identity=<main|sub:agent_id>`). One headless `claude -p` run: the main thread runs one marked command, then launches two Explore subagents in parallel that each run one marked command. User-level Bash hooks (git-safety, lore gates G1–G4) were active throughout.

| # | Observed | Verdict |
|---|---|---|
| F1 | SubagentStart inputs: `agent_id` `a778cab327bde77b9` and `a5e9180432cf806a1` (`agent_type` Explore). The PreToolUse inputs inside those subagents carried the same two ids respectively. The two ids differ. | ✅ PASS |
| F2 | Both subagents and the main thread received `REWRITTEN identity=…` as their tool result; the original `echo SPIKE_MARK …` never ran. | ✅ PASS |
| F3 | The main thread's PreToolUse input had no `agent_id` key. All three inputs carried the same `session_id` (`567003f4-…`). | ✅ PASS |
| F4 | The rewrite applied while the user-level Bash hooks were also registered. Those hooks return no `updatedInput` here; how two hooks that BOTH return `updatedInput` combine was not tested. | observation |
| F5 | The model's own tool_use record kept the ORIGINAL command; only the tool result reflected the rewrite. So spoof resistance comes from the hook unconditionally overwriting the identity argument, not from secrecy. A call path the hook does not match (a script file invoking `lore`, `bash -c`) would arrive with no attested identity — lore must then refuse rather than fall back. | observation |

### Viability — how wide is the change? (code measurement)

- CLI identity resolution is one function family (`resolveActor` / `resolveActorWithSource` / `resolveActorWithIdentitySource`): 83 non-test call sites in 41 files, all going through that chokepoint, plus 13 `resolveWriteActor` sites.
- MCP: 23 tool parameters named `by` / `recorded_by`.
- So the resolution change is central; the cost is in the MCP surface and in every `by` field acquiring a run reference.

## Ledger

| # | Solution | Risk | Experiment | Result | Tier | Verdict |
|---|---|---|---|---|---|---|
| S1 | Minimal: same-task claim conflict compares the claim's recorded `session_id` | Value | V1 | the failure it targets is real (2 silent takeovers) | E1 | ✅ validated (value) |
| S1 | 〃 | Feasibility | F3 | `session_id` is identical for a session and all its subagents → cannot separate concurrent subagents | E1 | ❌ **refuted as specified** — covers cross-session only |
| S2 | Worktree-first identity (move SPEC-104 `agent:<branch>` above the session tier) | Value / Feasibility | — | not run; reasoning only (covers worktree implementers, not the main thread or read-only agents in the main checkout) | — | ⚠️ unvalidated |
| S3 | Run identity issued by lore, attested by a harness adapter (SubagentStart register + PreToolUse inject), "agent" derived from runs | Feasibility (Claude Code Bash path) | F1–F3 | passed every pre-registered bar | E1 | ✅ validated |
| S3 | 〃 | Feasibility (MCP path) | — | not run | — | ⚠️ unvalidated |
| S3 | 〃 | Feasibility (other harnesses / human CLI) | — | not run | — | ⚠️ unvalidated |
| S3 | 〃 | Value (claims) | V1 | as S1 value | E1 | ✅ validated |
| S3 | 〃 | Value (derived agent views drive decisions) | — | not testable before build; only a stated wish | E6 | ⚠️ unvalidated |
| S3 | 〃 | Usability (agent needs to do nothing) | — | not run; would need a dispatched implementer with no bundle identity line | — | ⚠️ unvalidated |
| S3 | 〃 | Viability | code measurement | one resolver chokepoint + 23 MCP params | E1 | ✅ validated (cost bounded) |
| S4 | Persistent individual agents (named employees with private memory) | — | — | not tested; deprioritised by the user's judgement that fixing composition ex ante constrains AI execution | — | not tested (user decision, NOT refuted) |

## What this means

The cheap tests all passed and the one that mattered most (A1) passed cleanly: Claude Code does hand lore a distinct, stable per-subagent id at both registration and every tool call, and lore can put it into the call. The minimal fix S1 is refuted as specified — the one discriminator it relies on is exactly the one subagents share. So the defensible bet is S3, but only its Claude Code Bash path is proven; MCP and non-Claude callers are open.

Reshaped bet: **S3, Claude Code Bash path first**, with "no attested identity → refuse" (F5). That narrower shape is `⚠️ unvalidated` until built, because it was derived from these results, not tested by them.

## Carries forward

| Item | Source | Validation |
|---|---|---|
| Same-task claim by a different run is a conflict, not a refresh (fix BR-125, answer CLAM Q2) | V1 | ✅ validated — 2 silent takeovers measured |
| Per-subagent identity attested by SubagentStart + PreToolUse(Bash) `updatedInput` | F1–F3 | ✅ validated |
| A call without an attested identity is refused, never defaulted | F5 | ⚠️ unvalidated (derived) |
| MCP attestation | — | ⚠️ unvalidated — needs its own spike before P0 |
| Human CLI / HTTP / Codex attestation | — | ⚠️ unvalidated |
| Derived agent views (by template, by composition element) | user wish | ⚠️ unvalidated — not P0 |
| ~~Session-id-only fix (S1)~~ | F3 | ❌ refuted — non-goal, with the number: 3 of 3 hook inputs in one run carried the same `session_id` |

## Cross-cutting concerns

- **Privacy / data minimisation.** A run record would hold harness ids, the worktree path and the machine name, and humans are actors too. SPEC-025 explicitly excluded worktree paths from the corpus ("local filesystem paths are ephemeral and environment-specific"); the ideation's composition manifest conflicts with that and must resolve it (store-only, not corpus; or record branch, not path). The hook payload also carries `transcript_path` — never persist it.
- **Accountability / override.** An attested identity must not remove a human's ability to take over a task; takeover must stay possible but become explicit and recorded (`--steal`), which is precisely what V1 shows is missing today.
- **Harm potential.** Identity becomes a refusal input; any path that fails to inject identity must fail loud with a fix hint, or agents will route around it (the F5 bypass paths).

## Assumptions and confidence

| Assumption | Confidence |
|---|---|
| The problem is real and recurring in this repository | HIGH (E1, E3) |
| Claude Code's per-subagent `agent_id` is stable and injectable on the Bash path | HIGH for the version measured; harness behaviour can change between versions |
| The same holds for MCP calls | LOW — not run |
| Other teams have the same problem | LOW — one repository only |
| Derived agent views will be used | LOW — E6 |

## Next step

**Proceed** — to `/lore-product opportunity` to fill the skipped tree (and check no cheaper solution was missed), or straight to `decompose` for S3's Claude Code Bash path. Before any P0 that depends on MCP, run the MCP spike (A5).

---

# Round 2 — branch O2 "attribution" (2026-10-11)

Source tree: `knowledge-attributable-writes-opportunity-solution-tree`, branch O2 (Recommended). Outcome: share of claim + evidence + handoff writes naming exactly one attested run, 0% → ≥95%.
Kill lines pre-registered at 2026-10-11T07:11:24Z (X1–X5) and 07:12:37Z (X3b, added after X3 came back inconclusive), BEFORE the respective experiments; reproduced verbatim below. AI-set, not user-approved.

## Pre-registration (verbatim)

- X1 (O2-S6 "subagents never write"): Claude Code transcripts for this repo modified since 2026-09-11; count lore WRITE invocations (Bash commands invoking `lore` with a write verb, plus `mcp__lore__` write tools), main thread vs subagent transcript. KILL O2-S6 if subagent share > 30%.
- X2 (O2-S1 "remove free-text attribution"): task evidence rows recorded since 2026-09-11; classify `recorded_by` as session tier (`^agent:session-[a-z0-9-]{8}$`), OS fallback (`apple`), worktree-derived (`agent:<sanitized branch>` for a known branch), else explicit/env. KILL O2-S1 if explicit/env share < 60%.
- X3 (O2-S4 "claimed vs attested labels"): 3 fresh agents see the NEW format, 3 see the OLD format (control), same scenario, asked whom to hold accountable. Misattribution = names a specific actor/run as responsible without stating the attribution is unverified/self-reported. KILL if >1/3 NEW misattribute; INCONCLUSIVE if ≤1/3 CONTROL misattribute.
- X3b (registered after X3): same formats; ask ONLY for the message to send and its recipient, no confidence question. Misattribution = addressed to `agent:main-orchestrator` and states or presumes it made v7 without asking whether it did. Same KILL / INCONCLUSIVE rule.
- X4 (O2-S2, MCP half): PASS only if (a) PreToolUse fires for an `mcp__lore__*` call inside a subagent carrying that subagent's `agent_id`, AND (b) an `updatedInput` rewrite of an MCP argument changes the tool's result.
- X5 (O2-S5 signed token): not run (1–2 weeks build); analysis only → stays unvalidated.

## Results

| # | Experiment | Result | Tier | Verdict |
|---|---|---|---|---|
| X1 | 350 transcripts (19 main, 331 subagent) since 2026-09-11; regex over Bash `tool_use` commands + MCP write tool names | **2,908 lore writes; 2,040 from subagents = 70.2%**; MCP lore writes: **0** (every write went through Bash). Top verbs: evidence 567, claim 371, rule 311, set 268, ac 240, baseline 215 | E1 | ❌ **O2-S6 refuted** (70.2% vs 30% kill line) |
| X2 | 806 evidence rows since 2026-09-11 | session tier 0, OS fallback 0, worktree-derived 0, **explicit/env 806 (100%)**. Corroborated by X1's command text: subagent write commands carried `--by` 851× and a `LORE_ACTOR=` prefix 1,275×; main-thread commands `LORE_ACTOR=` 723× of 868 | E1 | ✅ O2-S1 premise holds — every recent attribution is free text |
| X3 | 6 agents, confidence question | NEW 0/3 misattributed (confidence 40/35/35%); CONTROL **0/3** misattributed (35/50/40%) | E1 (same model family as target users) | **inconclusive** — the confidence question primed doubt in both arms; the test could not discriminate |
| X3b | 6 agents, message only | NEW **0/3** (two wrote "if you made this change… if you did not, tell me"; one routed to the human owner); CONTROL **3/3** misattributed ("Your v7 update… you weakened…") | E1 (same model family) | ✅ **O2-S4 validated (usability)** — the control discriminates and the new format passes |
| X4 | Throwaway project + throwaway corpus (`lore init` under the scratchpad), project hooks: SubagentStart log; PreToolUse `mcp__lore__.*` log + rewrite `id_or_slug: SPIKE_MISSING` → `knowledge-spike-target-doc`; one headless run, main thread + 1 Explore subagent each calling `mcp__lore__lore_get` with `SPIKE_MISSING` | (a) the subagent's MCP PreToolUse input carried `agent_id a2fd3270c6f978506`, equal to its SubagentStart id; main thread had none. (b) both calls returned the target doc (`SPIKE_TARGET_CONTENT_7731`), which exists only in the throwaway corpus — the rewrite changed the result and the real corpus was not touched | E1 | ✅ **O2-S2 MCP half validated** |
| X5 | — | not run | — | ⚠️ unvalidated |

Not run this round: O2-S3 (read-time reverse lookup from transcripts) — ⚠️ unvalidated. Analysis only: X1 shows transcripts DO hold per-subagent command text, but they are local to one machine and subject to Claude Code's transcript cleanup period, so they cannot be the durable source of attribution.

## What this means

- **The problem is mostly a subagent problem.** 70% of writes come from subagents, and all of them share their parent's `session_id`. Forbidding subagent writes (O2-S6) is refuted; any fix must attest subagents individually.
- **The root cause is the free-text channel, not the resolver.** 100% of recent attributions came from `--by` or `$LORE_ACTOR`; the session tier was never reached. Fixing resolution order alone would change nothing while those stay authoritative.
- **Removing `--by` outright (O2-S1 as specified) would break 851 subagent write commands** that pass it today. Reshaped: keep the value, demote it to `claimed` (O2-S4's form), and never let it be attested.
- **Honest labelling works on its own for accountability.** With the old format 3 of 3 agents accused the named actor; with `attested: unattested · claimed: …` 0 of 3 did. This is the cheapest change in the branch and it addresses the original "accused the wrong agent" defect directly.
- **Attestation is feasible on both Bash and MCP** (round 1 F1–F3, round 2 X4). MCP is currently unused for writes (0 of 2,908), so it is lower priority but not blocked.

Reshaped bet (⚠️ unvalidated as a whole — derived from these results, not tested as a combination): **O2-S2 + O2-S4** — hook-attested run id on Bash and MCP writes; every surface prints `attested: <run|unattested> · claimed: <name>`; `--by` / `$LORE_ACTOR` survive only as `claimed`.

## Ledger — branch O2

| # | Solution | Risk | Experiment | Verdict |
|---|---|---|---|---|
| O2-S1 | Remove free-text attribution | Value | X2 | ✅ premise validated (100% free text) |
| O2-S1 | 〃 | Feasibility as specified | X1 (`--by` in 851 subagent commands) | ❌ refuted as specified — reshaped into O2-S4 |
| O2-S2 | Hook-injected run id | Feasibility (Bash) | round 1 F1–F3 | ✅ validated |
| O2-S2 | 〃 | Feasibility (MCP) | X4 | ✅ validated |
| O2-S2 | 〃 | Feasibility (non-Claude callers, human CLI, HTTP) | — | ⚠️ unvalidated |
| O2-S2 | 〃 | Viability (forgery) | — | ⚠️ unvalidated — see threat model below |
| O2-S3 | Read-time reverse lookup from transcripts | all | — | ⚠️ unvalidated (not run; weak as a durable source by analysis) |
| O2-S4 | `attested` vs `claimed` labels | Usability | X3 (inconclusive), X3b | ✅ validated (0/3 vs control 3/3) |
| O2-S4 | 〃 | Value | X2 + the recorded "accused the wrong agent" defect | ✅ validated |
| O2-S5 | Signed short-lived run token | Viability (forgery) | — | ⚠️ unvalidated |
| O2-S6 | Subagents never write | Value | X1 | ❌ refuted — 70.2% of writes are subagents' |

## Open decision surfaced (the user's, not the AI's)

**Threat model for attestation.** A same-user process can read any file the hook can (including a signing key or lore's own store), so neither a hook-held secret (O1-S3, O2-S5) nor a registry resists a deliberately malicious agent unless Bash runs under OS-level read restrictions (e.g. a sandbox deny-read on the key path — not measured). Against cooperative but error-prone agents — the only failure actually observed (X2, the 2026-08 incidents) — the hook unconditionally overwriting the identity argument is sufficient (round 1 F5), with "no attested identity → label `unattested`" for paths the hook does not see. Which threat model the product commits to decides whether O2-S5 is needed at all.

## Cross-cutting concerns (round 2)

- Privacy: X3b's new-format agent C addressed the human owner by an e-mail address taken from its runtime context, not from the scenario — subagents see the operator's identity; run records must not copy operator identity in beyond what attribution needs.
- Privacy: transcripts (O2-S3) are sensitive and machine-local; not a source to persist from.
- Accountability: the label change keeps humans able to act on an unattested record (X3b NEW-C routed to the owner) instead of silently trusting or discarding it.

## Assumptions and confidence (round 2)

| Assumption | Confidence |
|---|---|
| Subagents issue most lore writes in this repo | HIGH (E1, 2,908 writes) |
| All recent attribution is free text | HIGH (E1, 806/806, corroborated by command text) |
| The label change prevents misattribution by AI readers | MEDIUM — n=3 per arm, same model family as the target readers, one scenario |
| MCP attestation works as Bash does | HIGH for the version measured; MCP is unused for writes today |
| Regex classification of transcript commands is complete | MEDIUM — writes issued from script files or `bash -c` strings the regex does not match would be uncounted in both arms |

## Next step (round 2)

**Proceed to `/lore-product decompose` on the reshaped bet O2-S2 + O2-S4**, after the user settles the threat model. Leave O2-S3 and O2-S5 out of the first slice; carry non-Claude callers as `⚠️ unvalidated`.
