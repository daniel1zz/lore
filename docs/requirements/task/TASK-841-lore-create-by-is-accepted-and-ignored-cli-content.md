---
id: TASK-841
type: task
role: plan
title: "lore log and created_by print the literal system while the audit trail holds the real actor: a false label that made me accuse the wrong agent"
status: draft
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [attribution, silent-fallback, north-star, addressability]
parent: PRD-001
---
⛔ **THIS TASK'S ORIGINAL DIAGNOSIS WAS WRONG AND IS REWRITTEN BELOW. The original claimed attribution is NOT STORED. It IS stored — in the audit trail.** The retraction is kept in place rather than edited away, because the wrong version was acted on and the way it was wrong is the more useful finding.

MEASURED 2026-08-25 by agent:main-orchestrator.

## What is actually true — three surfaces, one fact, two answers

One write. `LORE_ACTOR=agent:main-orchestrator lore create task ...`:

| surface | answer |
|---|---|
| `lore audit <slug> --json` → `entries[].actor` | **`agent:main-orchestrator`** — correct |
| `lore log <slug>` → Author column | `system` |
| `lore get <slug> --json` → `doc.created_by` | `system` |

Reproduced in a throwaway corpus with an explicit `--by agent:explicit-flag` as well: the audit trail carries it, `created_by` and the version row do not.

So the actor resolution works and the write is not lossy. What is wrong is narrower and different: **two surfaces disagree about the same fact, and the one a reader reaches first prints a literal that reads like an actor named "system".** `lore create --help` documents `--by`'s fallback chain as "$LORE_ACTOR env var, then session tier, then OS username" — `system` is none of those three, so a reader of `lore log` has no way to know they are looking at a placeholder rather than an identity. That is a false label in the North Star's exact sense, and `auth.ts:40` / `:457` confirm it is deliberate legacy ("doc/version `created_by` stays the historical literal `\"system\"`").

## The cost, which I paid myself, in full

⛔ I used `lore log`'s Author column plus `lore bootstrap`'s `active_sessions` to determine who authored `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`, concluded it was a `lore-implementer` subagent I had dispatched, and **acted on that conclusion** — I sent that agent two course-correction messages accusing it of writing a spec outside its authority, and I recorded the accusation in `knowledge-handoff-agent-main-orchestrator-132`.

The accusation was FALSE. The agent ran `lore audit` and refuted it; I then reproduced its result: 25 entries, `agent:main-orchestrator` ×11, `system` ×10, the AI judge ×4, and **`agent:mirror-oracle-budget-isolation` ×0**. The writer was a DIFFERENT, CONCURRENT session using the same `agent:main-orchestrator` actor string. The corpus was addressable the whole time; I used the wrong instrument.

⛔ Two compounding reasons I reached a false conclusion, both worth mechanising:

1. **`lore log` is the discoverable surface and `lore audit` is not.** `lore log` is what the CLI, the docs, and habit point at for "who changed this". It answers `system` with no hint that a better answer exists one command over.
2. **`lore bootstrap`'s `active_sessions` did not list the writing session.** At 07:45 it showed exactly two sessions, both carrying `task_slugs` — and the session that had written the spec at 07:41-07:44 was absent. Every row in that field is keyed to a CLAIM, so a session doing pure planning writes (create spec / create plan / phase add / ac add / approve) holds no claim and is INVISIBLE there. ⛔ Therefore "only one other session is live" is NOT derivable from `active_sessions`, and I derived it. Root CLAUDE.md already warns that a listed doc is not proven live; this is the mirror of that — an UNLISTED SESSION IS NOT PROVEN ABSENT.

The bitter part, recorded because it is the actual lesson: the original version of this very task said *"that inference was only checkable because exactly one other session was live; under many concurrent sessions it would not have been."* I wrote that sentence and then relied on the inference anyway.

## Scope

- `lore log`'s Author column and `doc.created_by` must either carry the audit trail's actor, or render as an explicit `unattributed (see lore audit)` — ⛔ never a bare token that reads as an identity. Rendering must be injective: "we did not record this" and "an actor called system did it" must not print the same.
- ⛔ Historical rows MUST NOT be back-filled with guesses. Where the audit trail HAS the actor, deriving the version row from it is a lossless repair; where it does not, `unattributed` is the honest value.
- `lore bootstrap`'s `active_sessions` must make its claim-keyed scope legible, or include claimless writing sessions. A consumer cannot otherwise distinguish "no other session is active" from "no other session holds a claim". ⛔ This half is the one that actually caused a wrong action and should be sequenced first.

## The other half: nothing REFUSES an out-of-authority write either

Still true, still measured, and now the only part of the original finding that survives unchanged:

- `lore gate spec-create --explain` declares its input as `{type, title, parent_id?, content, extra?: {spec_kind?}}`. It never RECEIVES an actor, so it structurally cannot refuse based on who is writing — a missing input, not a missing predicate.
- `grep -rln "LORE_ACTOR\|subagent\|role" hooks/` returns nothing across all six hooks.

So role-based write authority is enforced by prose alone. ⛔ But note what the correction above does to the STAKES: because the audit trail does record the actor, an out-of-authority write is **unrefused but fully attributable**. The original "neither refused nor attributable" framing overstated it, and the overstatement is what made a false accusation feel safe to act on.

## Falsifier

⛔ Not "a create records an actor" — that passes today via the audit trail while both misleading surfaces keep lying. Assert the AGREEMENT, in one run, in a throwaway corpus:
(a) for the same write, `lore audit`'s `entries[].actor`, `lore log`'s author, and `doc.created_by` are EQUAL — equality, not containment;
(b) with `LORE_ACTOR=agent:Y` and no `--by`, all three equal `agent:Y`, proving the documented chain's first link;
(c) a control that must FAIL for the oracle to mean anything: where no actor is resolvable, all three read `unattributed` and NOT the string `system`.
Smallest mutation that turns it red: repair `created_by` and leave the version row on the literal, or vice versa — they are separate writes and one can be fixed while the other keeps lying.
