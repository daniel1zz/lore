---
id: SPEC-121
type: spec
role: spec
title: "An escalate blocks approval for every doc type, and the denial names the questions"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-10-23
tags: []
---
# An escalate blocks approval for every doc type, and the denial names the questions

## Overview/Goal

Implement `adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to`.

Today `ReviewService.enforceJudgmentRequiredGate` returns early for any doc type
outside `workflow.review.judgment_required_types` (default `["spec","adr"]`), so
`lore approve` succeeds on a `knowledge` doc regardless of the judge's decision.
Measured in one batch of six: two ADRs correctly blocked on `reject`/`escalate`,
while a `knowledge` doc with `reject 0.72` and another with `escalate 0.68` both
approved — and the escalate's three `blocking_questions` were filed into an approved
document that resurfaces in no queue.

`reject` is an opinion about content; gating it for a record-of-what-happened would
hold event capture hostage to a judge's disagreement. `escalate` is categorically
different: it asserts an outstanding human decision and carries the questions.

## Scope

**In scope**

- `escalate` blocks approval for EVERY doc type. `reject` keeps its
  `judgment_required_types` scoping, unchanged.
- The documented `judgment_required_types: []` total kill switch is preserved exactly:
  empty list → M2 fully disabled, escalate included, byte-identical to pre-SPEC-103.
- The `JUDGMENT_ESCALATED_REASON` denial renders the judgment's `blocking_questions`
  verbatim. A gate that blocks on "a human must decide" while withholding what must be
  decided has no path forward — measured on this very change's own ADR, where the
  denial named only `lore review <doc>` and the questions had to be read out of
  SQLite by hand.
- The `@invariant` block on `judgment_required_types` (`packages/core/src/config.ts`)
  is updated: it is the key's contract of record and currently says it governs all M2
  gating.

**Out of scope**

- A read-path banner rendering `blocking_questions` on the DOC itself (SPEC-043-style,
  for already-approved docs carrying unanswered escalates). Different surface,
  different audience; named in the ADR as deliberately separate. **Its population is
  measured, so the deferral is sized rather than vague: 10 docs are `approved`/`active`
  with an unanswered `escalate` as their LATEST review judgment — 8 of them `knowledge`
  (assessment/uat), plus one `spec` and the root `prd`.** Those 10 are invisible to
  this change by construction (see the version note below) and are exactly what the
  banner would serve.
- Judge calibration. If universal escalate gating proves noisy, the fix is the judge
  prompt, not re-hiding the questions.
- A retroactive sweep. **Measured 2026-07-31: zero additional documents are affected.**
  Exactly two docs carry a current-version `escalate`/`reject` (`j.doc_version =
  d.version`), both `adr`, both already `draft` and therefore already blocked. Recorded
  because the governing ADR budgeted for a back-catalogue pass on the general principle
  that a new detector retroactively invalidates history; here the pass is empty.

  **Why that is consistent with the Overview's approved-with-escalate knowledge doc** —
  review asked, and the answer is a real property of the mechanism, not an accounting
  trick. Judgments are matched to a doc VERSION, and a successful `approve` writes a new
  version. That doc was judged `escalate` at v1 and approved into v2, so its judgment no
  longer matches its current version and this gate — which evaluates at approve time
  against the then-current version — can never see it again. Of 27 escalate judgments in
  the corpus, 2 are on a current version and 25 are on a prior one.

  The consequence is worth stating plainly rather than leaving as a happy accident: this
  change is **forward-only by construction**. It prevents the next escalate from being
  filed away; it does not surface the 10 already filed. That is precisely why the
  read-path banner is a separate, still-owed piece of work and not a nice-to-have.

## Decisions

**D1 — the early return splits by decision, not by a second config key, and ONLY the
`escalate` verdict universalises.** No new config surface.
`enforceJudgmentRequiredGate` keeps reading `judgment_required_types`. For a type
outside the list, exactly one failure now propagates: `JUDGMENT_ESCALATED`. The other
three outcomes stay suppressed for such types — `JUDGMENT_REJECTED` (an opinion, per
the ADR), `NO_JUDGMENT`, and `JUDGMENT_PROVENANCE_COLLISION`.

An earlier revision of this spec said the preconditions also applied to every type.
That was wrong and review caught it: propagating `NO_JUDGMENT` for ungated types would
mean **every knowledge doc requires a judgment before it can be approved** — a far
larger change than the ADR authorises, and one that would break approving a routine
knowledge doc without reviewing it at all. AC-ESC-7 pins the corrected behaviour,
because "no judgment at all" is the most common state for an ungated doc and therefore
the likeliest thing an implementation gets wrong.

**D2 — `checkReviewJudgment` stays pure and unchanged.** It already returns distinct
`JUDGMENT_ESCALATED_REASON` / `JUDGMENT_REJECTED_REASON`
(`checkpoint-registry.ts`), so the split point exists at the caller. The predicate
must not learn about doc types — it holds no store and no IO, and type policy is the
service's concern.

**D3 — the empty list short-circuits before anything else.** `judgment_required_types
=== []` returns `ok(undefined)` immediately, ahead of the escalate path. A test pins
that an escalate on an empty-list config still approves, because that is the
documented invariant and the one behaviour a reader will assume this change broke.

**D4 — questions render verbatim, truncated by count not by characters.** The denial
lists every `blocking_questions` entry as its own line. If the array is empty (a judge
escalated without questions), the denial says so explicitly rather than printing an
empty section — an escalate with no questions is itself a defect worth surfacing.

**D5 (AMENDMENT 2026-07-31, post-implementation) — an escalate PRESENT blocks, even when a reject accompanies it.**

The first implementation filtered the predicate's single propagating failure, so on an
ungated type carrying BOTH a `reject` and an `escalate` on the same version,
`worstReviewDecision` yields `reject` (rank 2 > 1), the service suppresses `reject` for
ungated types, and the doc APPROVES — losing the escalate. The implementer surfaced this
and pinned it as an explicit BOUNDARY test rather than hiding it.

It contradicts the governing ADR ("filing an escalate silently is never right for any
type"), and the shape of the error is the reason it matters: adding a WEAKER signal — a
`reject`, which this spec deliberately treats as suppressible opinion for ungated types —
DESTROYS a STRONGER one, an assertion that a human decision is outstanding. A control that
can be defeated by adding noise is not a control.

Reachable, not theoretical: `lore review` does not bump the doc version, so two runs
against one version produce two same-version judgments that may disagree.

**Corrected semantics:** for a type outside `judgment_required_types`, the question is
"is any independent current-version decision an `escalate`?", NOT "is the worst-decision
denial an escalate?". The service already computes `independentDecisions` before building
the `GateContext`, so it can ask directly — no predicate change, and `checkReviewJudgment`
stays the single decision authority for the GATED path, where worst-decision-wins is
correct and unchanged (a reject there must never be outrolled).

Unchanged by this amendment: gated types (reject+escalate still blocks, on reject), the
`[]` kill switch (D3, still short-circuits first), and the anti-lottery rule itself.

## Acceptance Criteria

Script-mode ACs verified by `lore verify`. The load-bearing assertions are the
NEGATIVE and INVARIANT halves: that `reject` on an ungated type still approves (the
scoping is preserved, not quietly universalised), and that an empty
`judgment_required_types` still approves an escalate (the kill switch survives).


## Acceptance Criteria (structured)

- [⊖] [script] AC-ESC-1: An escalate blocks approval for an UNGATED type: a knowledge doc whose current version carries an escalate judgment is refused by ReviewService.approve with the JUDGMENT_ESCALATED reason, under the default judgment_required_types of spec and adr. This is the behaviour change; today the same call succeeds.
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'escalate blocks an ungated type'
- [⊖] [script] AC-ESC-2: NEGATIVE, load-bearing: a reject on an UNGATED type still APPROVES. The reject scoping is preserved rather than quietly universalised — a test that only asserts escalate now blocks would pass against an implementation that gated both, which the governing ADR explicitly rejects.
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'reject on an ungated type still approves'
- [⊖] [script] AC-ESC-3: INVARIANT, load-bearing: an EMPTY judgment_required_types still approves a doc carrying an escalate. The documented total kill switch (config.ts @invariant, AC-TIER-7) survives byte-identically; this is the one behaviour a reader will assume this change broke.
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'empty judgment_required_types remains a total kill switch'
- [⊖] [script] AC-ESC-4: The escalate denial renders every blocking_questions entry verbatim, one per line, so the writer learns what to answer from the refusal itself; and when the array is empty the denial says so explicitly instead of printing an empty section. Asserted on the feed message, not on the predicate.
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'denial renders the blocking questions'
- [⊖] [script] AC-ESC-5: Gated types are unaffected in both directions: a spec or adr carrying a reject is still refused, and one carrying an approve still approves. Pins that narrowing judgment_required_types to govern reject only did not weaken the types it already governed.
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'gated types unchanged'
- [⚑] [script] AC-ESC-6: Full typecheck passes, covering the config.ts @invariant documentation update on judgment_required_types — that block is the key's contract of record and currently states it governs all M2 gating, which this change makes false.
  script: tsc — bun run typecheck
- [⊖] [script] AC-ESC-7: D1's precondition half, the case most likely to break: an UNGATED type with NO judgment at all still APPROVES, and so does one whose only judgment collided with extra.ai_provenance. Only the escalate verdict universalises — propagating NO_JUDGMENT would silently require a judgment before any knowledge doc could be approved, a far larger change than the governing ADR authorises.
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'ungated type with no judgment still approves'
- [⊖] [script] AC-ESC-8: Documentation-contract oracle that typecheck cannot provide: the judgment_required_types @invariant block in packages/core/src/config.ts no longer claims the key governs M2 for ANY type, and states the reject-only scoping plus the preserved empty-list kill switch. Asserted by scanning that source region for the stale claim, paired with a control confirming the invariant block was located so a moved comment cannot let the check pass vacuously.
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'config invariant prose matches the shipped scoping'
- [⊖] [script] AC-ESC-9: D5: an escalate PRESENT blocks an ungated type even when a reject accompanies it on the same version. The pre-existing BOUNDARY test asserting that this pair APPROVES must be inverted — it currently pins the defect. Paired with two controls that must stay green: a gated type with the same pair still blocks on the reject (worst-decision-wins intact where it is correct), and an empty judgment_required_types still approves the pair (D3 kill switch short-circuits first).
  script: test — bunx vitest run packages/lore/tests/unit/service/review-judgment-escalate-scope.test.ts -t 'escalate present blocks even alongside a reject'
  other_command=1

## Code anchors

- packages/lore/src/service/review-service.ts#ReviewService
