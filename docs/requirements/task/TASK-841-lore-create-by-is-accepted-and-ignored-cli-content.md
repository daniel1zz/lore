---
id: TASK-841
type: task
role: plan
title: "lore create --by is accepted and ignored: CLI content writes hard-code created_by to the historical literal system while MCP resolves a real actor"
status: draft
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [attribution, silent-fallback, north-star, addressability]
parent: PRD-001
---
MEASURED 2026-08-25 by agent:main-orchestrator, from source, in a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it — never this repo's `.lore/`). Searched first for prior art on `created_by`/`system`/`--by` attribution and found none; if a record surfaces later this should be merged into it.

## The measurement

```
export LORE_ACTOR=agent:attribution-probe
lore create knowledge --title "Probe three" --sub-type reference --content x \
  --by agent:explicit-flag --no-ai
lore get knowledge-probe-three --json   ->  created_by = 'system'
lore log knowledge-probe-three --json   ->  entries[0].created_by = 'system'
```

Both an explicit `--by agent:explicit-flag` AND `LORE_ACTOR` in the environment are accepted and produce `system`. `lore set` shows the same on the update row. ⛔ This is NOT a rendering bug: the value is `system` in the stored record and in the stored version entry, so `lore log`'s Author column is reporting the truth. The write is what is lossy.

`lore create --help` documents `--by` as: *"Actor identity to attribute this create to (SPEC-079 G2) — also used for the --supersedes invalidate step, when present. Defaults to $LORE_ACTOR env var, then session tier, then OS username."* ⛔ `system` is none of the three fallbacks that sentence names — not the env var, not a session tier, and not the OS username (`apple` on this machine). So the flag is not merely defaulting oddly; the documented chain is not the chain that runs.

## Mechanism, read at the call sites rather than inferred

`system` is a deliberate legacy literal, and the code says so in three places:

- `packages/lore/src/adapters/http/auth.ts:40` — *"doc/version `created_by` stays the historical literal `\"system\"`"*, repeated at `:457`.
- `packages/lore/src/adapters/mcp/tools.ts:411` — the MCP surface resolves a real actor via `resolveActorWithSource` *"rather than the literal \"system\""*.
- `requirement-service.ts:268`, `ac-service.ts:864`, `drift-check-service.ts` — extra-writing services hard-write `created_by: "system"` with `actor: "system"` on the audit row.

⛔ So the defect is not "attribution is unimplemented". It is that **attribution is implemented on one surface and hard-written to a literal on its neighbour, and the CLI flag's help text describes only the implemented one.** Standing lesson, same shape, already in root CLAUDE.md: *"a refusal branch on one config shape and absent on its neighbour reads as guarded everywhere."* An attribution branch present on MCP and absent on the CLI reads as attributed everywhere.

The asymmetry is sharp and is visible inside one document's history. On `task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus` this session:

| version | action | recorded author |
|---|---|---|
| v4 | `lore scope add` | `agent:main-orchestrator` |
| v5 | `lore set --content-file` | **`system`** |
| v6 | `lore claim` | `agent:mirror-oracle-budget-isolation` |
| v7-v9 | `lore evidence` | `agent:mirror-oracle-budget-isolation` |
| v10 | `lore set --content-file` | **`system`** |

Governance actions are attributed. Content authorship is not. Same doc, same corpus, same session, adjacent rows.

## Why it matters, with the cost this session actually paid

The project's North Star: *"It must be addressable. Every assertion locatable and re-verifiable."* Content authorship is the one thing this corpus cannot attribute, and the corpus is the SSOT AND the coordination mechanism for many concurrent sessions.

Concretely, measured: `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by` appeared during this session carrying five ACs. Determining WHO wrote it was not answerable from the corpus — every version row said `system`. It had to be inferred from `lore bootstrap`'s `active_sessions` timing (one claim at 07:41:31Z, spec v1 at 07:41:49Z) plus content overlap. ⛔ That inference happened to be checkable because exactly one other session was live. Under the target state — "one project developed by MANY CONCURRENT SESSIONS" — it would not have been. An out-of-authority write by one agent would be indistinguishable from a legitimate write by another.

## Scope

- `created_by` on doc records and version entries written through the CLI must carry the resolved actor, using the SAME resolution the MCP surface already uses (`resolveActorWithSource`) — ⛔ reuse it, do not add a second resolver, or the two surfaces will drift again in the other direction.
- The extra-writing services (`requirement-service.ts`, `ac-service.ts`, `drift-check-service.ts`) hard-write `"system"` on both the version row and the audit row. Decide deliberately whether those are legitimately system-authored or whether they must carry the invoking actor, and record the decision either way. ⛔ A blanket sweep here would be wrong without that decision.
- ⛔ Historical rows MUST NOT be rewritten. `system` is the honest value for everything already written — it says "unattributed", which is true. Back-filling a guess would convert a known gap into a false label, which is strictly worse.

⛔ Out of scope: changing `--by`'s documented contract to match the code. The help text describes the behaviour a reader needs; the code is what is wrong.

## Falsifier

⛔ Not "a create records an actor" — that passes if the resolver returns the OS username while `--by` is still ignored. Three conjuncts, one run, in a throwaway corpus:
(a) `--by agent:X` yields `created_by === "agent:X"` on BOTH the doc record and the version entry;
(b) with no `--by` but `LORE_ACTOR=agent:Y` set, both yield `agent:Y` — proving the documented fallback chain's first link;
(c) a control that must FAIL to be meaningful: with neither set, the value is NOT `agent:X` from a previous case's leakage.
Smallest mutation that turns it red: restore the literal at either write site — the doc record and the version entry are separate writes and one can be fixed while the other keeps lying.

## The other half, measured the same session: nothing REFUSES the write either

This defect is one of two halves, and the pair is worse than the sum. Measured 2026-08-25:

- `lore gate spec-create --explain` declares its input as `{type, title, parent_id?, content, extra?: {spec_kind?}}` and describes itself as "legal parent, valid spec_kind, required skeleton". ⛔ It never RECEIVES an actor, so it structurally cannot refuse a write based on who is making it — this is not a missing predicate, it is a missing input.
- `grep -rln "LORE_ACTOR\|subagent\|role" hooks/` returns NOTHING across all six hooks (`commit-msg`, `g1-spec-create.sh`, `g2-spec-promote.sh`, `g3-plan-promote.sh`, `g4-task-claim.sh`, `pre-push`).

So "an implementer does not author specs" is enforced by prose alone. Root CLAUDE.md's own North Star asks: *"What refuses this when it is violated? 'An agent should remember' means NOT ENFORCED — say so, and count it."* Counted here.

⛔ The composition is the finding: an out-of-authority write is **neither refused nor attributable**. Measured instance, this session — a dispatched `lore-implementer` created `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by` and revised it to v10 with five ACs, minutes after claiming an unrelated `[Skill:test]` task whose bundle explicitly said the surface-change question was not its and that a blocked conclusion must be REPORTED, not acted on. No gate refused it, and every version row said `created_by: system`. Authorship was recoverable only because `lore bootstrap` showed exactly ONE other live session and its claim timestamp (07:41:31Z) sat 18 seconds before the spec's v1 (07:41:49Z). ⛔ Under the target state — "one project developed by MANY CONCURRENT SESSIONS" — that inference is unavailable, and the write would be untraceable.

⛔ Do NOT fix this by prescribing a more unique `LORE_ACTOR`: root CLAUDE.md already records that "a session-collapse report is NEVER fixed by prescribing a more unique LORE_ACTOR". The actor value was correct and unique here (`agent:mirror-oracle-budget-isolation`) and appears correctly on the claim and evidence rows — it is the CONTENT write path that drops it, and the gate that never asks.

⛔ Sequencing note for whoever fixes this: attribution must land BEFORE any authority predicate. A gate that refuses by role while the write path discards the actor would refuse on a value it cannot trust, which is worse than not refusing — it would make the corpus's own enforcement unauditable. Fix the write path first, then decide whether gates should receive the actor at all.

This half belongs in the unenforced-lessons ledger (`knowledge-the-nine-unenforced-standing-lessons-evicted-from`) once someone reconciles that doc's title with its count — ⛔ appending a tenth entry to a doc whose title says "nine" would make the title a false label, the same defect class this task is about.
