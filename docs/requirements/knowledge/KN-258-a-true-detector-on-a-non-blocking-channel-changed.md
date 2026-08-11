---
id: KN-258
type: knowledge
role: knowledge
title: "A true detector on a non-blocking channel changed nothing for eight days"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-123
links:
  - {id: SPEC-112, type: informs}
  - {id: PLAN-086, type: informs}
---
# A true detector on a non-blocking channel changed nothing for eight days

## Symptom as it surfaced

An operator pasted a Stop-hook line into a fresh session and asked what it was: `Stop hook error: Failed with non-blocking status code: Undispositioned resume ticket item: KD1`. The question "is this output/handling correct?" turned out to have two different answers for the two halves.

## What was measured

Session `2f45e6d9-2567-4d7b-9c68-2a739282301a`, ticket rendered 04:38:56, 9 items (KD1–KD4, NS1–NS5), 130 assistant text turns over the following 7h46m. Two Stop hooks armed simultaneously, same model, same Stop moments, differing only in delivery channel:

| hook | channel | fires | complied |
|---|---|---|---|
| `stop-doc-sync.mjs` | stdout `{"decision":"block","reason":<instruction + Required-output template>}`, exit 0 | 10 | **10** |
| `stop-handoff-coverage.mjs` | exit 1 + one stderr symptom line | 10 | **0** |

The detector was a TRUE POSITIVE every time — those 9 items really were unaccounted. The handling delivered nothing: exit 1 is non-blocking under the Stop contract, so it reached the transcript as a `hook_non_blocking_error` attachment carrying a bare symptom with no statement of the required output. The `Undispositioned` string appears 29 times in that transcript and `[RESUME_DISPOSITION]` zero times in any assistant message. The operator had to hand-carry the error into a later session for it to be acted on at all.

The control arm is what makes this a channel finding rather than a discipline finding: 10/10 versus 0/130, same model, one variable.

## Root causes, all three mechanism-level

1. **The AC asserted the wrong half.** SPEC-112's AC-RC-7 pinned "exits non-zero", which exit 1 satisfies while delivering nothing. It stayed green for eight days over a mechanism with zero measured effect. The governing spec even named `stop-doc-sync.mjs` as its enforcement precedent — but that hook blocks via stdout JSON, and the new hook copied the precedent's SHAPE (a blind pipe relaying a verb) without copying its DELIVERY MECHANISM. Nothing in the AC set could tell the difference.

2. **Arming was content-addressed where it needed to be provenance-addressed.** The predicate was "some tool_result contains a cardinality line plus the coverage-floor declaration", with no notion of which tool produced it. Probe: a transcript that never ran `lore feed session-resume`, holding only `cat docs/archive/old-handoff.md` output, made the verb name all 9 ids and exit 1. Reading, grepping, or quoting an archived handoff imposed a fabricated accounting duty. Text equality is not origin equality.

3. **A constraint-forced design produced a semantics its own prose could not honour.** SPEC-112 D8 banned cross-process state for a measured reason (`CLAUDE_SESSION_ID` is unset in this harness, so turn-state files resolve to different ppids and the gate would have shipped silently inert). The cost: the verb reads dispositions only from `last_assistant_message` and therefore forgets prior turns, so a ticket accounted at turn N re-arms at turn N+1 — while both the governance prose and the floor constant say "before the session ends". D5's claim that the gate "can be armed unconditionally without becoming noise" did not survive per-turn semantics.

## Transferable lessons

- **A notification-or-enforcement mechanism needs an AC on its DELIVERY, not only on its detection.** "Exits non-zero", "logs a warning", "returns an error object" are all satisfiable while the intended recipient is never reached. This is the sixth recorded variant of the false-oracle class in this repo, and the first where the oracle measured the right VALUE on the wrong CHANNEL. Ask: who is the recipient, and does an AC assert the recipient received it?
- **When a spec cites a working precedent, pin the precedent's mechanism, not its silhouette.** Copying "blind pipe relaying a verb" while silently swapping the block channel for an exit code is a failure a shape-level review cannot see.
- **Arming predicates over transcripts must key on the producing call, not on the produced text.** Anything a session can READ, a session can be blamed for. Observed acutely: while investigating this defect the assistant had to deliberately withhold the cardinality line from its own tool output to avoid arming a fabricated duty against itself.
- **When prose and implementation disagree about scope ("session" vs "turn"), the implementation moves.** Rewriting the prose to match a constraint-forced implementation would have retired a correct requirement to excuse an incomplete one. Here the transcript itself supplied the missing memory without reintroducing the banned cross-process state — the constraint never actually required the degraded semantics.

## Two smaller mechanism findings from the same session

- **A pipe erases the exit code you were about to test.** `lore ac rm ... | tail -1` inside a `for` loop reported success for seven consecutive failures (the flag `--by` is not valid on that subcommand); `|| exit 1` measured `tail`'s status, not the command's. The batch looked clean and changed nothing. Only the post-batch state assertion (expected AC id set) caught it. Corollary to the standing "`set -e` is inert in the agent shell" lesson: never measure an exit code through a pipe, and always assert resulting STATE after a corpus-write batch.
- **`lore create spec --help` trips the armed spec-create PreToolUse gate.** A help request is not a write; the gate denies it for `PARENT_REQUIRED` / `MISSING_SKELETON`. Discoverability of every gated create verb is blocked for exactly the audience that needs it. Recorded, not fixed.
