---
id: KN-284
type: knowledge
role: knowledge
title: "An ungated approve is not a mechanized approve — a judge's escalate can be filed away, blocking questions and all"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
links:
  - {id: KN-297, type: informs}
---
# An ungated approve is not a mechanized approve — a judge's escalate can be filed away, blocking questions and all

## What happened

Batch-processing six stale pending documents, the orchestrator reasoned: "running
`lore review` then `lore approve` is safe because if the judge rejects, the gate
blocks the approve — so there is no rubber-stamp risk." That premise was stated to
the user and the user's choice of scope rested partly on it.

It is false for four of the six document types. Measured in the same batch:

| doc | judge decision | `lore approve` |
|---|---|---|
| `knowledge-turn-state-mjs-resolvesessionid…` | approve 0.82 | approved |
| `knowledge-dashboard-human-friendliness…` | **reject 0.72** | **approved** |
| `knowledge-bun-build-compile-embeds…` | approve 0.76 | approved |
| `adr-product-skill-chain…` | escalate 0.68 | **BLOCKED** ✅ |
| `knowledge-grill-review-2026-07-28…` | **escalate 0.68** | **approved** |
| `adr-distribution-first…` | **reject 0.72** | **BLOCKED** ✅ |

Root cause, and it is DESIGN, not a defect:
`workflow.review.judgment_required_types` defaults to `["spec", "adr"]`
(`packages/core/src/config.ts:502`; `resolveJudgmentRequiredTypes` at `:918`).
`ReviewService.enforceJudgmentRequiredGate` returns `ok(undefined)` early when
`!requiredTypes.includes(doc.type)` — an explicit per-type kill switch. This repo's
`.lore/config.yaml` carries no `judgment` key, so the default governs.

The rationale is sound: a knowledge doc records what happened. An AI judge
disagreeing with a retro does not make the retro false, and gating it would make
event capture hostage to a judge's opinion.

## The consequence that is NOT benign

`escalate` does not mean "the judge disliked this". It means *a human must decide*,
and the judgment carries a `blocking_questions` array holding what they must decide.
For an ungated type, `approve` succeeds and those questions are filed into an
approved document where nothing surfaces them again. They are not lost from the
database — `review_judgments.blocking_questions` still holds them — but no command
in the normal loop reads them back: `lore pending` only lists non-approved docs,
and the approved doc renders no banner.

So the failure mode is precise: **an escalate on an ungated type degrades from
"a human must answer these" to "these are in a table nobody queries."**

## The three questions this actually swallowed

Preserved verbatim so they survive independently of the judgment row, since the
document carrying them is now `approved` and will not resurface in any queue.
They belong to `knowledge-grill-review-2026-07-28-seven-product-direction`:

1. Does Decision 4's auto-approve for `task`/`assessment`/`retro`/`handoff`
   supersede parent PRD **G9's data gate** ("≥1 doc type at `auto` on
   Wilson-bounded agreement data", R2 contingent per §14.6), or is it intended to
   wait on trace data from Decision 3? As written it removes review ceremony
   before the instrumentation that Decision 2 declares a precondition exists.
2. Decisions 1 and 4 change **PRD-committed scope** (freeze on G5 cloud sync / G6
   HTTP adapter; `auto` tier ahead of G9's gate) and the product's positioning.
   Should these land as an ADR and/or PRD amendment rather than being recorded
   only in a knowledge doc — and if so, should that amendment be added to "Next
   candidates" before the document is approved?
3. How is writer≠approver (Decision 4) determined once Decision 5 derives actor
   from the git worktree branch — does the independent fresh-context reviewer
   agent run in a distinct worktree (distinct derived actor), or is an explicit
   `LORE_ACTOR`/`--by` required for reviewers?

Note the recursion, which is why this is worth recording rather than just
answering: question 1 asks whether auto-approving execution-exhaust types is
premature, and the mechanism that let this very document be approved on an
`escalate` is the same class of ungated-approval it proposes to extend.

## The generalisable lesson

**"A gate exists" is not "this gate covers my case."** The orchestrator knew the
`review-judgment` checkpoint existed, had watched it correctly block two ADRs
minutes earlier, and generalised from that to every type. The per-type scope was
one grep away (`judgment_required_types`) and was not checked, because the gate
firing twice felt like proof it was universal.

Before invoking a gate as the reason an action is safe, read the gate's SCOPE, not
just its existence. Observing a gate fire tells you it applies to the case that
fired — nothing more.

## Options for the owner (a policy choice, not a bug fix)

Deliberately listed rather than decided, because all three are defensible:

- **Leave as is.** Knowledge stays ungated; escalates there are advisory. Accepts
  that blocking questions must be caught by whoever reads the review output live.
- **Add `knowledge` to `judgment_required_types`.** Strongest, and directly against
  the tiered-review direction the grill doc argues for — it would gate exactly the
  execution-exhaust types that doc wants auto-approved.
- **Gate on `escalate` only, for every type.** Narrowest fix matching the actual
  harm: a `reject` on a knowledge doc is an opinion, but an `escalate` asserts a
  human decision is outstanding, and filing that silently is never right. Would
  need a predicate change (`checkReviewJudgment` already distinguishes
  `JUDGMENT_ESCALATED_REASON` from `JUDGMENT_REJECTED_REASON`, so the split point
  exists) plus a config key to scope it.

A cheaper adjacent improvement, independent of the above: have the read path
surface an unanswered `escalate`'s `blocking_questions` on the doc (the way
SPEC-043 shows an invalidation banner on direct-address reads), so the questions
are visible wherever the document is, regardless of which types are gated.
