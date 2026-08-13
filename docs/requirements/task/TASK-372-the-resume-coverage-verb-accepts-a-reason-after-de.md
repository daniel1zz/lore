---
id: TASK-372
type: task
role: plan
title: "The resume-coverage verb accepts a reason after deferred: but rejects one after done, and reports the explained completion as 'still unaccounted' — the asymmetry costs a Stop round-trip and discourages the more informative disposition"
status: archived
priority: low
created: 2026-08-02
updated: 2026-08-12
tags: []
parent: PRD-001
---
## Measured 2026-08-02 by the orchestrator

A session dispositioned all ten items of `knowledge-handoff-agent-main-orchestrator-70`, writing five of
them as `done — <justification>` (em-dash, then the evidence for the completion). The verb rejected all
five and re-fired the Stop gate reporting them as *"still unaccounted for"*, then on the second pass
correctly distinguished the case:

    The following item(s) were already named this session, but with a disposition token
    this verb does not recognize — that is NOT the same as never mentioning them:
    - KD1: received "done — 作为本轮基线消费…" — the only accepted forms are `done` or `deferred:<reason>`.

## The asymmetry

- `deferred:<reason>` — a reason is REQUIRED and parsed.
- `done` — a reason is FORBIDDEN; appending one invalidates the token entirely.

So the grammar permits explaining why work was NOT done, but not what evidence shows it WAS. That is
backwards relative to this repo's own evidence discipline, where a completion claim is the one that
should carry its oracle. An author who writes the more informative form is punished for it.

## Severity — genuinely limited, and this is why it is filed low

⛔ It does NOT fail quiet. The first message is misleading ("still unaccounted"), but the second names
each offending item, quotes the exact text received, and states the accepted forms. The author is
never left guessing and no state is silently lost. This is a strictness/UX defect costing one
round-trip, not a member of the fail-quiet class this repo treats as high severity.

## Required

1. Accept `done:<reason>` and/or `done — <reason>` as valid, discarding or recording the trailing text.
   ⛔ Do not solve it by tightening the docs — the instruction text ALREADY says "the only accepted forms
   are `done` or `deferred:<reason>`", and a defect already covered by existing prose is proof the prose
   layer is the wrong layer.
2. If the strictness is deliberate (e.g. the token is machine-consumed downstream), say so at the point
   of failure and keep the current loud rejection — but then make the FIRST message distinguish
   "mis-tokened" from "never mentioned" rather than only the second, since the first message's
   "still unaccounted for" is factually wrong about an item that was named.

## Oracle

- NEGATIVE (fails today): a transcript dispositioning an item as `done — <text>` is accepted, or is
  reported on the FIRST pass as mis-tokened rather than as unaccounted.
- REGRESSION: a genuinely unmentioned item is still reported as unaccounted, and `deferred:<reason>`
  still requires its reason.
- BOUNDARY: `done` with trailing whitespace only; `deferred:` with an empty reason.

## Provenance

Hit while closing `knowledge-handoff-agent-main-orchestrator-70`. Filed under the standing dogfooding
mandate to consciously eval every hook/gate we depend on rather than working around it silently.


## SECOND independent reproduction — 2026-08-03, orchestrator, different session and handoff

Reproduced against `knowledge-handoff-agent-main-orchestrator-77` (14 items). The author had READ
this repo's CLAUDE.md and the Stop gate's own instruction text, and still wrote six items as
`done — <evidence>` because attaching the oracle to a completion claim is the natural act under this
repo's evidence discipline. The eight `deferred:<reason>` items were accepted; all six `done — …`
items were rejected.

**This is the point: the defect is not a one-off slip.** It reproduces across sessions, across
handoff tickets, and in an author who knows the rule — because the grammar contradicts the
surrounding discipline. Frequency evidence for whatever priority review this task gets: two
measured occurrences, two different sessions, identical natural-language form.

## CORRECTION — Required #2 is already satisfied; only #1 remains open

The 2026-08-02 filing says the FIRST message is misleading and only the SECOND distinguishes
mis-tokened from never-mentioned. **Measured 2026-08-03: that is no longer true.** The very first
Stop response carried BOTH sections at once — the `N item(s) still unaccounted for` header AND the
`already named this session, but with a disposition token this verb does not recognize — that is NOT
the same as never mentioning them` block, quoting each rejected string verbatim.

⛔ An implementer taking this task must NOT re-implement Required #2. Verify the current behaviour
first (the header wording is still arguably wrong — it counts mis-tokened items as "unaccounted"
in the same breath as saying they were named), then scope the work to Required #1: accept a reason
after `done`.
