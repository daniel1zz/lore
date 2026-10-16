---
id: TASK-855
type: task
role: plan
title: "active_sessions is built from claims only, so a session that writes without a claim is invisible"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"attribution","tags":["attribution","false-label","addressability","concurrency","north-star"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2e5c847a-2e81-4270-850c-af534d89f2be"}
---

For the SAME write, `lore audit` names the actor correctly while `lore log`'s Author column and `doc.created_by` print the literal `system`. The misleading surface is the discoverable one, and acting on it caused a false accusation against another agent in this session.

MEASURED 2026-08-25.

## Three surfaces, one fact, two answers

One write: `LORE_ACTOR=agent:main-orchestrator lore create task ...`

| surface | answer |
|---|---|
| `lore audit <slug> --json` → `entries[].actor` | **`agent:main-orchestrator`** — correct |
| `lore log <slug>` → Author column | `system` |
| `lore get <slug> --json` → `doc.created_by` | `system` |

Reproduced with an explicit `--by agent:explicit-flag` as well: the audit trail carries it, `created_by` and the version row do not. `lore set` behaves the same on the update row.

⛔ So attribution is NOT lost — the write is not lossy and the resolver works. The defect is narrower and worse-placed: **the surface a reader reaches first prints a token that reads like an actor named "system".** `lore create --help` documents `--by`'s chain as "$LORE_ACTOR env var, then session tier, then OS username" — `system` is none of those three, so nothing tells the reader they are looking at a placeholder. `adapters/http/auth.ts:40` and `:457` confirm it is deliberate legacy: "doc/version `created_by` stays the historical literal `\"system\"`".

The asymmetry is visible inside ONE document's history:

| version | action | recorded author |
|---|---|---|
| v4 | `lore scope add` | `agent:main-orchestrator` |
| v5 | `lore set --content-file` | **`system`** |
| v6 | `lore claim` | `agent:mirror-oracle-budget-isolation` |
| v7-v9 | `lore evidence` | `agent:mirror-oracle-budget-isolation` |
| v10 | `lore set --content-file` | **`system`** |

Governance actions are attributed. Content authorship is not. Same doc, same session, adjacent rows.

## The measured cost — a false accusation, acted on

I needed to know who authored a spec that appeared mid-session carrying five ACs. I read `lore log`'s Author column (`system`) and `lore bootstrap`'s `active_sessions` (two rows, both mine), concluded it was a subagent I had dispatched, and ACTED: I sent that agent two accusatory course-correction messages, recorded the accusation in a handoff, and asked my user to decide whether to quarantine or discard what I believed was rogue output.

The accusation was FALSE. The agent ran `lore audit` and refuted it; I reproduced its result — 25 entries: `agent:main-orchestrator` x11, `system` x10, the AI judge x4, and the accused agent's actor **x0**. The writer was a different concurrent session using the same actor string.

⛔ A second, compounding gap made the wrong conclusion feel safe: **`active_sessions` rows are keyed to a CLAIM** (every row carries `task_slugs`), so a session doing pure planning writes — `create spec`, `create plan`, `phase add`, `ac add`, `approve` — holds no claim and is INVISIBLE there. At 07:45Z the field listed two sessions; the session that had written the spec between 07:41Z and 07:44Z was absent. "Only one other session is live" is NOT derivable from that field, and I derived it. AN UNLISTED SESSION IS NOT PROVEN ABSENT.

## Scope

- `lore log`'s Author column and `doc.created_by` must either carry the audit trail's actor, or render as an explicit `unattributed (see lore audit)`. ⛔ Rendering must be injective: "we did not record this" and "an actor called system did it" must not print the same string.
- ⛔ Historical rows MUST NOT be back-filled with guesses. Where the audit trail HAS the actor, deriving the version row from it is a lossless repair; where it does not, `unattributed` is the honest value.
- `active_sessions` must make its claim-keyed scope legible, or include claimless writing sessions. ⛔ This half is the one that actually caused a wrong ACTION and should be sequenced first.

## Falsifier

⛔ Not "a create records an actor" — that passes today via the audit trail while both misleading surfaces keep lying. Assert AGREEMENT, one run, throwaway corpus:
(a) for the same write, `lore audit`'s `entries[].actor`, `lore log`'s author, and `doc.created_by` are EQUAL — equality, not containment;
(b) with `LORE_ACTOR=agent:Y` and no `--by`, all three equal `agent:Y`;
(c) a control that must FAIL for the oracle to mean anything: where no actor is resolvable, all three read `unattributed`, NOT the string `system`.
Smallest mutation that turns it red: repair `created_by` and leave the version row on the literal, or vice versa — they are separate writes and one can be fixed while the other keeps lying.

**Expected:** For any write, the actor is reported consistently across lore audit, lore log's Author column, and doc.created_by — or, where no actor is resolvable, all three say 'unattributed' rather than a token that reads like an identity. And a consumer can distinguish 'no peer session is active' from 'no peer session holds a claim'.
**Actual:** lore audit names the actor correctly while lore log and doc.created_by print the literal 'system' for the same write, including when --by is passed explicitly. Governance rows (claim/evidence/scope add) ARE attributed, content writes are not — visible in adjacent versions of one doc. Separately, bootstrap's active_sessions rows are claim-keyed, so a session doing only planning writes does not appear at all. Reading those two surfaces together, I misattributed a peer session's spec to a subagent I had dispatched, sent it two accusatory messages, recorded the accusation in a handoff, and asked my user to dispose of what I wrongly believed was rogue output. lore audit had the correct answer the whole time: the accused actor appears 0 times in 25 entries.
**Repro command:** `T=$(mktemp -d) && cd $T && lore init >/dev/null && LORE_ACTOR=agent:probe lore create knowledge --title Probe --sub-type reference --content x --by agent:explicit-flag --no-ai >/dev/null && echo '--- audit ---' && lore audit knowledge-probe --json | python3 -c "import json,sys;print([e['actor'] for e in json.load(sys.stdin)['data']['entries']])" && echo '--- created_by ---' && lore get knowledge-probe --json | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['doc']['created_by'])"`

Reported by: agent:main-orchestrator
