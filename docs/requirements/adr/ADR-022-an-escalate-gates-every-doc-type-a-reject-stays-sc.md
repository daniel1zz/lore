---
id: ADR-022
type: adr
role: decision
title: "An escalate gates every doc type; a reject stays scoped to spec and adr"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# An escalate gates every doc type; a reject stays scoped to spec and adr

## Context

`workflow.review.judgment_required_types` defaults to `["spec", "adr"]`
(`packages/core/src/config.ts:502`). `ReviewService.enforceJudgmentRequiredGate`
returns early for any other type, so `lore approve` succeeds on a `knowledge` doc
whatever the judge decided. Measured in one batch of six: two ADRs were correctly
blocked on `reject`/`escalate`, while a `knowledge` doc with `reject 0.72` and
another with `escalate 0.68` both approved.

The per-type scoping is deliberate and correct in its motivation. A knowledge doc
records what happened; an AI judge disagreeing with a retro does not make the retro
false, and gating event capture on a judge's opinion would be worse than not gating
it. That reasoning is sound — **for `reject`.**

It does not transfer to `escalate`. The two decisions are categorically different:

| decision | asserts | filing it away means |
|---|---|---|
| `reject` | the judge disagrees with the content | an opinion is unrecorded — recoverable, and the doc is still true or false on its own merits |
| `escalate` | **a human decision is outstanding**, carried in `blocking_questions` | the question never reaches the human |

The measured consequence: an `escalate` carrying three questions about PRD-committed
scope was approved. Nothing resurfaces it — `lore pending` lists only non-approved
docs, no read path renders `blocking_questions`, and the row sits in
`review_judgments` where no command in the normal loop queries it. The escalate
degraded from *"a human must answer these"* to *"these are in a table nobody reads."*

## Decision

**`escalate` blocks approval for EVERY doc type. `reject` keeps its current
`judgment_required_types` scoping.**

Config shape: `judgment_required_types` continues to govern `reject` only. Escalate
gating is unconditional and needs no type list — a decision that says "a human must
decide" is never satisfied by the document's type.

The predicate seam already exists: `checkReviewJudgment` returns distinct
`JUDGMENT_ESCALATED_REASON` and `JUDGMENT_REJECTED_REASON`
(`checkpoint-registry.ts`), so the split is a wiring change in
`enforceJudgmentRequiredGate`'s early return, not a new classification.

Clearing an escalate is not the same as overriding it: the writer answers the
questions, which changes the document, which bumps its version — and judgments are
matched per-version, so a fresh judgment is required anyway. The mechanism already
routes to "answer, then re-review" without a bypass being added.

### The gate message MUST render `blocking_questions` — same slice, not adjacent work

An earlier revision of this ADR deferred all `blocking_questions` surfacing to
separate work. That was wrong, and it was proven wrong by this ADR's own review:
the escalate gate blocked **this document**, and the denial output named only the
recovery command (`lore review <doc>`), not the three questions to answer. Finding
them required querying `review_judgments` in SQLite directly.

A gate that blocks on "a human must decide" while withholding what must be decided
has no path forward for the writer, and this is strictly worse once escalate gating
is universal — today's narrow scope limits the blast radius of that omission.

So `feedReviewJudgment`'s `JUDGMENT_ESCALATED_REASON` branch renders the judgment's
`blocking_questions` verbatim in the denial. This is in scope here, not deferred:
extending a gate's reach while its denial is unactionable converts a useful signal
into an obstacle. The read-path banner on the DOC (the SPEC-043-style rendering,
which serves already-approved docs carrying unanswered escalates) stays separate —
that is a different surface with a different audience.

### The `[]` kill switch survives intact

`judgment_required_types: []` is a documented, test-pinned invariant
(`config.ts` `@invariant`, AC-TIER-7): it disables M2 **entirely**, byte-identical
to pre-SPEC-103 behaviour. Universal escalate gating must not quietly break that
off-switch — an operator who turned M2 off gets it off.

Therefore, precisely: an EMPTY `judgment_required_types` disables M2 for every
decision, escalate included. A NON-EMPTY list gates `reject` for the listed types
and `escalate` for all types. Only the non-empty case changes behaviour, so no
operator loses an escape they currently have.

## Consequences

**No conflict with tiered review.** Execution-exhaust types (`retro`, `handoff`,
`assessment`, `session-review`) auto-approve **at create time** with no judge
invoked at all — verified this session: `lore create knowledge --sub-type retro`
lands `approved (v1)` directly, while `--sub-type reference` lands `draft`. This
decision only governs the path where a judgment EXISTS, so auto-approved types are
untouched. The tiered-review direction and this decision are orthogonal.

**Escalates become blocking, which is the point.** A judge that escalates liberally
will stall the queue. That is the correct pressure: it pushes calibration work onto
the judge prompt rather than letting an unanswered question be silently filed. If it
proves too noisy, the fix is judge calibration, not re-hiding the questions.

**Operator-facing change surface.** The semantic narrowing of
`judgment_required_types` (it now governs `reject` only) needs the config JSDoc
`@invariant` block updated in the same slice — that block is the key's contract of
record and is where `[]`'s total-kill-switch meaning is already pinned. No startup
warning is added: the only behavioural delta for an existing non-empty config is
that escalates now also gate, which is the intended tightening rather than a
surprise to be warned about, and a warning on every startup for a permanent
condition is noise. An operator who wants the old escalate behaviour has the `[]`
kill switch.

**Retroactive back-catalogue.** Arming this detector retroactively invalidates the
back-catalogue exactly as this repo has measured before — every already-approved doc
carrying an unanswered escalate lands in violation the moment the predicate arms.
Budget the one-time sweep in the SAME slice, and prefer a written exemption per doc
over synthesising answers to clear the gate.

## Adjacent improvement, deliberately kept separate

Surface an unanswered escalate's `blocking_questions` on direct-address reads of the
doc, the way SPEC-043 renders an invalidation banner. That makes the questions
visible wherever the document is, independent of which types are gated — a read-path
capability, not a gate change, and it should not ride on this decision.

## Alternatives rejected

- **Add `knowledge` to `judgment_required_types`.** Rejected: gates `reject` too, making event capture hostage to a judge's opinion — the exact harm the current default avoids. It also collides head-on with the tiered-review direction.
- **Leave everything as is; catch escalates by reading review output live.** Rejected: that is precisely what failed. The output WAS read, the decision label WAS seen, and the questions were still filed — because the approve succeeded and nothing downstream marked the doc as owing anything.
- **Gate both `reject` and `escalate` universally.** Rejected: over-corrects past the measured harm and discards the sound motivation behind the existing scoping.
