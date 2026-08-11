---
id: KN-241
type: knowledge
role: knowledge
title: "Two gaps T1 surfaced: a change selector blind to spawn-style tests, and an undefined sidechain rule"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-123
links:
  - {id: PLAN-086, type: informs}
---
# Two gaps T1 surfaced: a change-selector blind to spawn-style tests, and an undefined sidechain rule

## 1. `test:changed` selected ZERO vitest files for a change whose own test file exists

T1 changed `packages/lore/src/adapters/cli/commands/handoff.ts` — the `coverage-check` verb. Its oracle, `bun run test:changed <base>`, reported `371 pass / 0 fail` at exit 0 across 51 files, and the implementer recorded that as evidence in good faith.

But `packages/lore/tests/unit/handoff-coverage-check.test.ts` — the test file for exactly that verb — was **never selected**: the selector reported `vitest: selected 0`. That file *spawns* the CLI as a child process instead of importing it, so there is no import edge from the test to `commands/handoff.ts`, and a transitive reverse-dependency selector has nothing to walk.

The orchestrator ran it manually and it was RED: 3 failures. (They turned out to be assertions this spec deliberately supersedes, so the verdict was fine — but the oracle had not measured it, and would not have measured a genuine regression there either.)

**This is structurally identical to the already-catalogued `.bun.test.ts` blind spot**, except it hits a plain `.test.ts` file under vitest, which the existing lesson does not warn about. The invariant is not about file naming: **any test that reaches its subject through a process boundary is invisible to an import-graph change selector.**

Mechanization directions (not yet chosen): have `changed-tests.ts` union the import-graph result with a *path-affinity* result (a changed `commands/handoff.ts` selects `**/handoff*.test.ts` regardless of import edges); or have spawn-style tests declare their subject explicitly (a header pragma the selector reads); or make the selector report its own coverage of the change set so `selected 0` for a non-empty diff is loud instead of a silent green.

Standing form of the lesson: **a change selector's exit 0 is only as trustworthy as its edge model — for any changed source file, ask which of its tests reach it by spawn rather than by import, and run those by hand.**

## 2. The arming predicate is undefined for sidechain (subagent) transcript entries

> **⛔ PREMISE REFUTED, 2026-08-01 — read this before acting on §2.** The
> sentence below claiming Claude Code writes subagent turns into the SAME
> transcript file is FALSE on this harness version. Measured across 3,928
> transcripts: all 427,493 `"isSidechain":true` occurrences live in separate
> `<session-id>/subagents/agent-<id>.jsonl` files; **zero** appear in any
> main-chain file. Shadow-discharge as described here is unreachable today (and
> doubly so — `scanTranscript` reads dispositions only from `type:"assistant"`
> entries, while a subagent report re-enters the main chain inside a
> `type:"user"` `tool_result`). Option (c) DID ship, but as a strict tightening
> justified by the unstated-assumption risk rather than by a live vector — see
> `spec-resume-coverage-floor-the-satisfaction-boundaries-a` S2/S3 and
> `knowledge-a-recommendation-s-premise-is-the-thing-to-re-measure`. The MCP
> namespace half of the same follow-up was REFUSED:
> `adr-the-coverage-floor-s-mcp-arming-compares-the-tool-name-s`.
> §1 of this document (the change-selector blind spot) is UNAFFECTED and still open.


`spec-resume-ticket-coverage-floor-blocking-channel-arming` H4 arms the coverage floor when a `tool_result` is paired with an originating `tool_use` that is a `lore feed session-resume` call. H5 satisfies expected ids from the union of dispositions in every post-ticket assistant message.

Neither decision says anything about `isSidechain`. Claude Code writes subagent turns into the SAME transcript file as the main chain, flagged `isSidechain: true`. The implementer correctly did not invent a rule and reported the silence.

Consequences of the current (unfiltered) behaviour:

- A **subagent** that runs `lore feed session-resume` arms the floor for the **main** session — the Stop hook only ever fires for the main chain, so the main agent inherits an obligation it did not create.
- Worse, under H5 a **subagent's** disposition lines also COUNT toward satisfying it. The obligation can therefore be discharged inside a subagent transcript the operator never reads, which defeats the point: the accounting exists so the human sees what happened to each item.

Three candidate rules, none yet chosen:

- **(a) Ignore sidechain entries entirely.** Clean, but if a subagent genuinely consumes a ticket, nobody accounts for it.
- **(b) Keep current behaviour** (arm and satisfy from any chain). Cheapest, but permits shadow-discharge as described.
- **(c) Asymmetric — arm from any chain, satisfy only from the main chain.** A subagent consuming a ticket obliges the main agent to account for it explicitly, and no subagent output can silently discharge it. This is the option that preserves the mechanism's purpose, and it is a strict tightening of today's behaviour.

Recommendation: (c), as a follow-up slice with its own AC (a sidechain-produced ticket arms; a sidechain-only disposition set does NOT satisfy; a main-chain disposition set does — three fixtures, one control each). Deliberately NOT folded into the current spec: its eight ACs are a converged slice, and reopening an approved spec would demote it and freeze the downstream `task-claim` gate for the two oracle tasks still in flight.
