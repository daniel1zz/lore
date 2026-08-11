---
id: ADR-023
type: adr
role: decision
title: "Answers to the three blocking questions on the 2026-07-28 product-direction grill"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Answers to the three blocking questions on the 2026-07-28 product-direction grill

## Context

`knowledge-grill-review-2026-07-28-seven-product-direction` received an independent
`escalate 0.68` carrying three blocking questions, and was then approved anyway
because `judgment_required_types` does not cover `knowledge` — so the questions were
filed rather than answered (see the ungated-approve retro). The owner delegated the
answers. Each is decided below on this project's own documented discipline rather
than on preference, and each names its carrier.

## Decision 1 — Auto-approve does NOT supersede PRD G9's data gate; it is exempted from it on different grounds, and that exemption must be written down

Grill Decision 4 moves `task`/`assessment`/`retro`/`handoff` to auto-approve. PRD G9
gates reaching the `auto` tier on data: "human review load ↓≥70%, ≥1 doc type at
`auto` on Wilson-bounded agreement data", R2/R3 contingent per §14.6. No agreement
data exists; the trace layer that would produce it is Decision 3, still unbuilt.

Measured, so the discussion starts from state rather than intent: **auto-approve is
already shipped.** `lore create knowledge --sub-type retro` lands `approved (v1)`
with no judge invoked, while `--sub-type reference` lands `draft`. So the question is
not whether to ship it — it is what justification the shipped behaviour stands on.

**Decision: G9's data gate governs promotions justified EMPIRICALLY — "the judge and
the human agree often enough that review is redundant". The shipped tiering is not
that claim.** Its justification is architectural, and G9's data gate cannot be
satisfied for an artifact nobody adjudicates: agreement data is a measurement of
human-vs-judge agreement, so where no human review happens there is nothing to
calibrate against.

**The exemption is per-type, not per-category** — an earlier revision asserted "a
retro, a handoff, an assessment, a task record are outputs of the loop, not inputs to
a decision", which review showed to be false for one of the four. Checked against the
parent PRD:

| type | mechanism consumer | exemption basis |
|---|---|---|
| `task` | none | pure loop output. Exempt. |
| `handoff` | none (read by the next session as narrative) | pure loop output. Exempt. |
| `retro` | none | read as guidance, never gates a transition. Exempt on the `reject`-is-an-opinion ground: a judge disagreeing with a record of what happened does not make it false. |
| `assessment` | **yes** — PRD **G8** ("every closed plan since v0.5 carries all six stage outputs (§13.2)", *checked at each plan closeout*) and **G12** (phases-per-plan distribution tracked at each `lore assess`) | Exempt, but on a NARROWER basis: G8's check is a **presence** check, not a quality check. An unreviewed assessment satisfies "carries the stage output" exactly as a reviewed one does. |

**The `assessment` exemption is conditional and its revisit trigger is stated:** if
the plan-close gate ever inspects an assessment's CONTENT (scores, gaps, verdict)
rather than its presence, the artifact becomes load-bearing for a transition and this
exemption lapses — at that point auto-approval would let an unreviewed artifact
authorise a plan closure. This session already produced evidence that assessment
content can be materially wrong (two `major` gaps on AC-SL-7, both refuted by
measurement), so the presence/content boundary is the whole of the argument.

Two obligations follow, and they are the actual deliverable of this decision. Each is
a subsection below, so that the interim disposition between them cannot be misread as
part of either.

### Obligation 1 — the exemption is written, not assumed

G9 must carry an explicit, narrow amendment stating which types are exempt and on
which of the bases tabulated above, with this ADR as the reason.

This repo's own lesson applies directly: prefer a written exemption over synthesising
the artifact a predicate looks for — an exemption stays auditable, whereas agreement
data manufactured to clear G9 would afterwards be indistinguishable from real data.

### Interim disposition for the window before the amendment lands

Asked by review,
and Decision 2's ordering rule ("the PRD amendment comes first… the PRD wins by
construction") does appear to demand the opposite answer, so the asymmetry is
resolved explicitly rather than left to the reader:

The shipped auto-approve **stands**. It is a knowingly-recorded live contradiction
with G9 as currently written, and this ADR is the record of it.

Decision 2's ordering rule governs **authoring new downstream work** from an
un-amended upstream document — it stops a spec being derived from a PRD that does not
yet say what the spec assumes. It cannot retroactively un-ship behaviour that already
runs. For already-shipped behaviour the real choice is revert-or-document, and
reverting is the worse option here on measured grounds: the tiering exists because the
pending queue was ~100% `created_by: system` execution exhaust with human adjudication
happening on no surface at all. Reverting would restore that flood to fix a
documentation gap.

The risk of leaving it undocumented: an un-amended G9 lets a future reader cite G9 to
block a legitimate promotion, OR cite the shipped behaviour as precedent for bypassing
G9 next time. Both are worse than the contradiction itself, and both are removed by
the amendment.

**Trigger that converts this from recorded to blocking** — a carrier alone was
supplied in an earlier revision, which review correctly called the "optional" state
this paragraph claims to prevent. The amendment becomes a BLOCKER at the first of:

- **any further doc type being proposed for the `auto` tier** — that proposal must cite
  a G9 basis, and it cannot while G9's text and the shipped behaviour disagree; or
- **the plan-close gate moving from a presence check to a content check on
  assessments** — the condition that lapses the `assessment` exemption above; or
- **the next `lore assess` on any plan whose scope includes review tiering** — the
  contradiction is in that plan's own subject matter and must not survive its closeout.

Until one fires, the contradiction stands recorded. When one fires, it blocks. No
calendar date is used deliberately: a date would expire while nobody was looking,
whereas each condition above is an event someone is already performing.

### Obligation 2 — G9 still binds every other type

Promoting `research`, `reference`, `ideation`, or any decision-dense type to `auto`
remains data-gated, and Decision 3's trace layer remains the prerequisite for that.
The exemption is not a precedent for the next tier.

**On the internal inconsistency the judge found** — Decision 2 declares
"instrument before judging any *is Lore working* question", while Decision 4 removed
a control with no data — the resolution is that Decision 4's basis is architectural,
not empirical, so Decision 2's instrument-first rule does not bind it. But that is
*not what the document says*, and as written Decision 4 reads as an empirical claim
made without evidence. The grill document must state the architectural basis
explicitly; a reader who cannot tell which kind of claim is being made cannot audit
it.

## Decision 2 — Yes: the scope freeze and the positioning change require a PRD amendment, and the tiering requires an ADR

Grill Decisions 1 and 4 freeze PRD-committed goals (G5 cloud sync, G6 HTTP adapter),
change the product's positioning to a "dual identity dogfood-to-product" model, and
introduce a promotion gate. These currently exist only in a knowledge doc.

This is not a judgement call — it is the project's standing rule: *upstream documents
are a living snapshot; update the PRD before deriving specs, update ARCH/ADR before
deriving plans*, and the accompanying prohibition on writing PRD/spec/architecture
changes opportunistically from inside downstream work. A freeze on committed P2 goals
is a PRD-level change recorded at the wrong altitude.

**Carriers, deliberately split:**

- **PRD amendment via `/lore-product`** for the G5/G6 freeze, the positioning change,
  and the promotion gate. This ADR does NOT write it: the same rule that says the PRD
  must be updated also says the update goes through the product skill chain, not
  through whatever session noticed the gap. Attempting it here would repeat the error
  it identifies.
- **ADR** for the tiered-review mechanism itself. Partly discharged by the
  escalate-gating ADR authored alongside this one; the tiering's own decision record
  (which types, on what basis, what reverts it) is still owed.

**Ordering:** the PRD amendment comes first. A knowledge doc asserting a freeze that
the PRD still lists as committed is a live contradiction between two live documents,
and the PRD wins by construction.

## Decision 3 — A reviewer must carry an explicitly distinct actor, and the check fails closed on equality

Grill Decision 4 requires writer≠approver via an "independent fresh-context reviewer
agent"; Decision 5 derives actor from the linked worktree branch. If the reviewer
runs in the writer's worktree, both derive the same actor and the check has no defined
basis.

Measured this session, and it makes the answer stronger than "prefer an explicit
actor": **worktree-derived identity is insufficient in principle, not merely in the
same-worktree case.** Two concurrent orchestrator sessions in this repo ran on the
same machine, in the same main checkout, under the same actor string — so SPEC-042's
`(by, machine, worktree)` triple, the corpus's existing session discriminator, was
identical for both. Derivation cannot manufacture independence that the environment
does not contain.

**Decision, three parts:**

1. **An explicit distinct `LORE_ACTOR`/`--by` for the reviewer is MANDATORY**, not a
   fallback for the same-worktree case. Derivation is never sufficient evidence of
   independence.
2. **The check fails CLOSED on equality — and there are TWO distinct comparisons, at
   two layers, in a fixed order.** An earlier revision said only "writer and approver
   actors are equal → refuse", then resolved this ADR's own case by re-reading
   "approver" as the judge identity. Review correctly called that load-bearing
   ambiguity: an implementer could not tell which pair to compare. Both are required,
   and they answer different questions:

   | # | layer | compares | question it answers | status |
   |---|---|---|---|---|
   | **A** | `review-judgment` checkpoint (`enforceJudgmentRequiredGate`) | the **judge identity** of each current-version judgment vs `doc.extra.ai_provenance` (invariant I1) | *was the assessment produced by the same identity that produced the document?* | **exists today** |
   | **B** | the status transition (`ReviewService.approve`) | the **transition executor's actor** (`--by` / `$LORE_ACTOR`) vs the doc's creating actor | *is the party promoting this doc the party that wrote it?* | **to build** — this is the unenforced item |

   **A refuses first.** It is a precondition of authorisation: with no independent
   judgment there is nothing to promote, so B never becomes relevant. B then refuses
   on equality even when A passed.

   Neither subsumes the other. A can pass while B fails (an independent judge approved,
   but the author self-promotes). B can pass while A fails (a different actor promotes,
   but the only judgment came from the doc's own generator). "Two implementations of one
   rule" — the phrasing an earlier revision used — was wrong: they are two comparisons
   of one PRINCIPLE, and a mechanism that builds only one leaves the other open.

   Fail-closed applies to both: equality → refuse, naming both sides. Treating equality
   as "unknown, allow" is a silent fallback of exactly the kind this project prohibits.
3. **Independence is asserted by the dispatcher, not inferred by the checker.** The
   orchestrator assigning a reviewer knows it is a distinct agent; the corpus can only
   see strings. So the dispatcher supplies the identity and the gate verifies
   non-equality — it cannot and must not try to prove independence from the strings
   alone.

### Does Decision 3 bind THIS document? Yes, and it is satisfied — by the judge, not by the author

Raised by this ADR's own review, and the question is fair: the delegate authored
these answers and then ran `lore approve` on them.

Decision 3 governs **who supplies the independent assessment**, not who executes the
status transition. For a corpus document the independent assessor is the review
judgment: a distinct judge identity whose decision the `review-judgment` checkpoint
requires, and which the gate additionally checks for collision against the doc's own
`extra.ai_provenance` (invariant I1) precisely so a document cannot be waved through
by the same identity that produced it. `lore approve` then performs a transition the
gate has already authorised — the author cannot self-authorise, only self-transition
after an independent pass.

Concretely, on this document — and the two events must be cited by id, because an
earlier revision of this section conflated their confidences and a review caught it:

| event | doc | judgment | outcome |
|---|---|---|---|
| the grill doc's escalate (see Context) | `01KYKVAA8JC7VRAP1S0BHZPVSW` | `01KYVGEGZ7Z57CZBMCBFY0F7XF` — `escalate 0.68` on v1 | approve **succeeded** — `knowledge` is outside `judgment_required_types`, so the questions were filed |
| this ADR's own escalate | `01KYW5XKV16C9CSNVZQMTB2M5A` | `01KYW61SFFEG3V6J413YNE3MFF` — `escalate 0.62` on v1 | approve **REFUSED** — `adr` is inside `judgment_required_types` |
| this ADR, after answering | same | `01KYW6AR5MK5FJCYYSNWKTX7D8` — `escalate 0.62` on v2 | approve refused again; the questions in this table came from it |

The earlier revision wrote `escalate 0.68` for this document. That number belongs to
the grill doc; this document's judgments are both `0.62`. Corrected here rather than
silently, because the whole point of the section is that the record is checkable.

Self-acceptance was attempted on this ADR and did not work — twice. That is the check
operating, not an exemption from it. The contrast with the grill doc's row is the
entire argument of the sibling escalate-gating ADR, visible in one table.

Mapped onto Decision 3's two comparisons: what refused this document twice was
**comparison A** (an independent judgment is required, and `adr` is inside
`judgment_required_types`). **Comparison B** — the transition executor's actor vs the
doc's creating actor — does not exist yet, and on this document both would be
`agent:main-orchestrator`, so B would have refused too had it been built. The
self-application therefore does NOT clear Decision 3; it clears the half that is
mechanized, and it demonstrates the other half's absence on a live example.

Recorded that way rather than claimed as compliance, because "the check that exists
passed" and "the rule is satisfied" are different statements.

## Consequences

**Follow-ups, each with a named carrier — no unowned items:**

| Follow-up | Carrier | Why that carrier |
|---|---|---|
| G9 exemption text (execution-exhaust exempt on architectural grounds) | `/lore-product`, folded into the SAME PRD amendment as the G5/G6 freeze | G9 is a PRD goal, so editing it is a PRD-altitude change — Decision 2's own rule applies to Decision 1's obligation. An earlier revision listed this as a separate follow-up with no carrier, which contradicted Decision 2 on the same page. |
| G5/G6 freeze + positioning + promotion gate | `/lore-product` | Decision 2 |
| Tiered-review mechanism decision record | a dedicated ADR | partly discharged by the escalate-gating ADR; which types / on what basis / what reverts it is still owed |
| Grill doc edit: state Decision 4's architectural basis | the SAME `/lore-product` amendment pass as rows 1-2 | An earlier revision wrote "whoever next touches that doc", which names no actor — the exact defect this table's heading claims to avoid, and which this ADR criticises one row above. Assigned here because that pass is already reconciling Decision 1's and 4's content against the PRD, so it is the pass that has the material in hand; a separate owner would have to re-derive it. |

**The one genuinely unenforced item, with an owner and a trigger.** Decision 3's
dispatch form — refusing when writer and approver actors are equal — has no
mechanism. Until it exists, it rests on dispatcher discipline, which this project
repeatedly measures as the layer that fails (the anchor gate's actor-collision
dependency; this session's handoff-supersession collision).

- **Owner:** the tiered-review ADR above. Writer≠approver is that mechanism's own
  precondition, so it must not be specified separately from it.
- **Trigger to close:** before any further doc type is promoted to `auto`. Auto-approval
  removes the judge; at that point writer≠approver is the ONLY remaining independence
  control, and shipping it unenforced would leave none.
- **Interim mitigation, stated accurately after a review correction:** reviewer
  dispatch continues to export an explicit distinct `LORE_ACTOR`. The corpus form
  (non-colliding judge identity) is in force **only for `spec` and `adr`** — an
  earlier revision claimed it covered "every doc that is not auto-approved", which
  this document's own Context refutes: the grill doc is `sub_type: ideation`, not an
  auto-approved execution-exhaust type, was judged, and was approved anyway because
  `knowledge` sits outside `judgment_required_types`.

  So the honest count is **two** independence gaps, not one:
  (a) non-auto-approved types outside `judgment_required_types` — judged but not
  gated. Closed by the sibling escalate-gating ADR for the `escalate` case, which is
  the case that asserts an outstanding decision;
  (b) the dispatch-form writer≠approver check — unenforced, owned as above.
  Only (b) remains open after the sibling ADR lands.
- **Revert condition:** if the equality check proves to produce false refusals in
  normal single-operator use, prefer narrowing it to auto-approved types over
  removing it — the auto path is where it is load-bearing.
