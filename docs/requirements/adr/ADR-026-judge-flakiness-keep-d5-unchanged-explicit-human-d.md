---
id: ADR-026
type: adr
role: decision
title: "Judge flakiness: keep D5 unchanged — explicit human dismissal already ships as --override-judgment, and an N-consecutive-escalate threshold would reward re-rolls"
status: approved
priority: high
created: 2026-08-01
updated: 2026-10-10
tags: []
parent: PRD-001
---
## Context

An AI judge returned `escalate` AND `approve` on the IDENTICAL document version.

Measured, from `lore get 01KYY3KM0STXS0X80PQB62KGS7`:

| Run | Doc version | Decision | Confidence |
|---|---|---|---|
| 3 | 35 | `escalate` | 0.72 |
| 4 | 35 | `approve` | 0.72 |

Same document, same version, same assembled prompt, opposite verdicts, identical
confidence. `adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to` (**D5**)
states: *"escalate blocks approval for EVERY doc type. reject keeps its current
judgment_required_types scoping."* So a single unlucky sample blocks promotion.

The originating handoff framed the problem as: *one coin flip locks a version until the
doc is edited*, and proposed **direction b** — *"N consecutive escalates, or explicit
human dismissal instead of a doc edit"* — as the remedy that *"preserves intent without
rewarding re-rolls."*

**That framing rests on a false premise, and the proposed remedy is self-defeating.**
Both findings are measured below.

## Finding 1 — the premise is false: explicit human dismissal ALREADY SHIPS

`lore approve --help`, run at HEAD `f3242aa`:

- `--override-judgment <id>` — *"SPEC-103 M2 audited escape — id of an existing
  review_judgments row on this doc whose blocking verdict (or absence) to override.
  Skips the judgment-required gate for this call only; recorded on the approve audit
  entry as `override_judgment_id`."*
- `--override-no-judgment` — *"audited escape … for the ONE denial it cannot reach:
  NO_JUDGMENT with zero review_judgments rows … recorded as `override_no_judgment`."*

A doc edit is therefore **NOT** the only unlock path, and has not been for some time. The
"explicit human dismissal" half of direction b is already built, already audited, and
already names the specific judgment being overridden.

This is the second time this session's standing lesson has fired: *Escalation ≠ build —
a twice-recommended mechanization triggers a VERIFICATION pass first, not a build pass.*
A remedy proposed against an unverified premise would have shipped a duplicate of an
existing audited escape.

## Finding 2 — "N consecutive escalates" rewards re-rolls; it does not prevent them

The handoff's own stated goal was to avoid rewarding re-rolls. The proposed threshold
does the opposite, and this follows directly from Finding 3's non-determinism:

Under an N-consecutive rule, a caller who dislikes a verdict re-runs the judge. Every
`approve` sample resets the counter. With a non-zero flip probability, the counter
**can never reliably reach N** for anyone willing to re-run — the rule converts a hard
block into a patience test, and the caller who re-rolls most wins. It also leaves no
artifact: nothing in the corpus records that a block was worn down.

Compare the three unlock paths on whether they leave an auditable trace:

| Path | Explicit? | Leaves an artifact? |
|---|---|---|
| Edit the doc | yes | yes — a new version |
| `--override-judgment <id>` | yes | yes — audit entry naming the judgment |
| Re-roll until the counter resets | **no** | **no** |

The existing two paths are the only ones that survive this test.

## Finding 3 — the non-determinism is structural, and cannot be removed at this layer

`GenerateInput` (`@lore/core/ai.ts`) carries `prompt` / `doc_type` / `title` /
`parent_title` and **no sampling parameters** — no temperature, no seed, no top_p.
`ClaudeCliProvider` spawns a CLI invocation that exposes no such knob either. So the
judge is deterministic at the application layer (identical input ⇒ identical prompt) and
non-deterministic at the model layer, with no control surface in between.

Pinning a seed would require changing the `@lore/core` type contract, the provider, and
backward-compatibility coverage. That cost is unmeasured, and the benefit is unquantified
because of Finding 4.

## Finding 4 — the flip rate is UNKNOWN, and one pair cannot establish it

Distinct (doc, version) pairs with ≥2 recorded verdicts: **1**. Of those, disagreeing: 1.

A "100% disagreement rate" over a single re-run pair is not a rate. All seven observed
runs come from concentrated testing of ONE document in ONE session. No corpus-wide audit
of multi-verdict (doc, version) pairs has been run.

⛔ Changing a gate's blocking semantics on n=1 would be exactly the evidence failure this
project's discipline exists to prevent. The direction was to be decided *from
flip-frequency evidence, not the single observed pair* — and the evidence is absent, so
the honest output is a decision NOT to change, not a change justified by the pair.

## Decision

**Keep D5 unchanged. Build nothing. Record `--override-judgment` as the sanctioned
response to a suspected judge flip.**

Rejected alternatives:

- **A — N consecutive escalates before blocking.** Rejected: rewards re-rolls (Finding
  2), leaves no artifact, and would be calibrated on n=1 (Finding 4).
- **B — add an explicit human dismissal.** Rejected as *already shipped* (Finding 1).
  Building it would duplicate `--override-judgment`.
- **D — pin a sampling seed.** Rejected for now: no control surface at this layer
  (Finding 3), unmeasured cost, and unquantified benefit (Finding 4). Revisit only if a
  measured flip rate justifies it.

## Consequence — what a caller does when a verdict looks like a flip

1. Do NOT re-run the judge hoping for a better sample. A re-run that "fixes" the verdict
   is indistinguishable from a re-roll and leaves no trace of why the block lifted.
2. Read the blocking questions. If they name content the judge could not see, that is a
   truncation artifact, not a flip — fix the document's section ordering.
3. If the verdict is genuinely wrong, approve with
   `lore approve <doc> --override-judgment <judgment_id>`. The audit entry records which
   judgment was overridden and by whom. That record is the point.

## What would reopen this decision

A corpus-wide audit of multi-verdict (doc, version) pairs yielding a measured
disagreement rate. Until that number exists, any change to D5's blocking semantics is
unevidenced. The query is stated in the originating investigation: group persisted review
judgments by (doc, version), keep groups with more than one verdict, and count those with
more than one distinct decision.
