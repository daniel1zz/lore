---
id: ADR-031
type: adr
role: decision
title: "Governance-document conflict exposure is deferred: read-count telemetry cannot observe a compliance failure, and the mechanism needs its own design pass"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
# Context

A downstream consumer measured `lore trace stats` on 2026-08-10/11 and reported four
observations. Three of the four became mechanized fixes, split across two specs:
`spec-a-write-side-fact-with-no-read-side-address-counts-with-no` absorbs two of them
(counts with no member list; a taxonomy with no retrieval filter) and
`spec-the-defect-channel-cannot-be-honestly-maintained-an` absorbs the third by way of
the defect channel's own supersession gap. The fourth observation is DIFFERENT in kind
and is recorded here rather than silently dropped.

The observation: the session's most severe failure was that a governance document
(`lore-uat`'s `execution-protocol.md`) **was read in the same turn** and the agent then
wrote dispatch instructions contradicting it, because a global CLAUDE.md rule
conflicted. `lore trace stats` records RETRIEVAL (`get`/`search`/`feed`) — whether a
doc was opened. It structurally cannot observe whether an opened doc was OBEYED, so
this class of failure is invisible to it by construction, not by omission.

The consumer's stated want: "when two governance documents conflict on the same topic,
that conflict MUST be surfaced explicitly".

# Decision

**Two separable questions, decided differently.** This ADR is precise about which is
which, because its whole subject is precision about what has and has not been decided.

**(a) DECIDED, in force from this document's acceptance** — the retrieval/compliance
distinction. A nonzero `feed`/`get`/`search` count is evidence of RETRIEVAL ONLY and
MUST NOT be cited as evidence that a rule was followed. This constraint binds now; it
is a statement about what the existing telemetry can and cannot support, requiring no
new mechanism to hold.

**(b) DEFERRED, no direction chosen** — the conflict-exposure mechanism itself. Do not
extend `lore trace stats` toward compliance measurement, and do not build
conflict detection as part of the current retrieval-reachability work. Three unresolved
design questions make any implementation now premature:

1. **What is a topic key?** Two docs conflict only relative to some shared subject.
   Nothing in the corpus declares one today. Deriving it from FTS similarity would fire
   on every retro that quotes another retro.
2. **What counts as disagreement?** "Always X" vs "never X" is decidable; "prefer X" vs
   "X has these costs" is not. Without a decidable predicate the mechanism becomes an
   LLM judge — which this project's own discipline permits only as ADVISORY, and an
   advisory conflict warning is exactly the prose layer that already failed here.
3. **At which checkpoint is it surfaced?** A conflict is only actionable at the moment
   an agent is about to act on one of the two docs. That is a `feed` concern, not a
   `trace` one, so the fix does not live where the measurement lives.

`extra.decision_status` is `proposed` — the ARCHITECTURAL DIRECTION in (b) is not
adopted, only its deferral is. That field is orthogonal to this document's own
lifecycle `status`, which follows the ordinary review workflow like any other doc: an
approved ADR carrying `decision_status: proposed` means "the team has accepted this
record of an open question", not "the team has accepted a design".

# Consequences

- Part (a) is binding: any future report that reads read-counts as compliance is wrong
  by this decision, and may be refused on that basis alone.
- Part (b) leaves the failure mode unmechanized. That is a knowingly accepted gap, not
  an oversight — recorded so it cannot be rediscovered as a surprise.
- Reopening (b) requires answering all three questions above with a decidable
  predicate, not a judge prompt. A proposal that supplies only an LLM-judged
  conflict warning does not clear that bar and should be refused against this ADR.
- The three mechanized observations are tracked by their own specs' acceptance
  criteria; this document holds no ACs and gates nothing beyond (a).
