---
id: KN-326
type: knowledge
role: knowledge
title: "Root-cause synthesis: the eight dogfooding findings are one defect eight times — a proxy substituted for an invariant, with the delta unrepresented"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PRD-001
links:
  - {id: ADR-017, type: informs}
  - {id: KN-327, type: relates-to}
---
# Root-cause synthesis: the eight dogfooding findings are one defect eight times — a proxy substituted for an invariant, with the delta unrepresented

## Context

`knowledge-gates-and-the-review-judge-validate-a-spec-against` (v9) records EIGHT independent mechanism findings from the context-provenance build, each with its own local root cause and its own proposed mechanization. `adr-plan-close-predicates-must-measure-invariants-not-proxies` (approved, v5) acts on two of them.

This document does two things the eight-finding retro does not: it establishes the SHARED root cause across all eight (so the fix can be typed rather than enumerated), and it corrects one measured fact the ADR gets wrong.

## Measured correction to the approved ADR (verified 2026-07-30, this turn)

The ADR states that `prdOutlineSynced` blocked `plan-implementation-context-provenance-scope-declaring` because "ANY content change inside the window satisfies it / a plan that legitimately introduces no domain-level capability has nothing to write". That analysis is sound as a design critique but is NOT the proximate cause of the observed block.

Measured:

- `spec-context-provenance-injected-corpus-global-state-and-a` (`01KYRC3F`) has `parent_id` = the root PRD (type `prd`, not `spec`), and its only outgoing links are `governs` / `informs` — no `implements` edge to a spec.
- `CorpusService.resolvePrdSyncDomainDoc` therefore returns `ok(null)` — a FACT ("no domain doc exists for this spec"), which its own JSDoc explicitly calls "a FACT, never an error".
- `CorpusService.set`'s plan-close branch then does `let synced = false; if (domainDoc !== null) {…}` and unconditionally sets `prdSyncSynced: synced` — so `null` falls through into the VIOLATING verdict.

So the block was **domain-doc absence rendered as a sync violation**, not a missing content change in the window. The same function leaves `prdSyncSynced` UNSET (vacuous pass) for the sibling absence case (`bundle.spec === undefined`), citing "no upstream spec edge, nothing to gate". The asymmetry is unjustified and is the same "absence of evidence rendered as evidence of absence" class this codebase already fixed once at `spec-plan-closure-must-be-loud-terminality-divergence-silent` DD-4(b) (`ReachabilityWhy: "unknown"` vs `"parent-not-spec"`).

Consequence for the ADR: its Consequences section says mechanism-fix plans "still need `prd_sync_exempt`". For any plan whose ancestor spec has no domain doc — which includes both plans in flight — the correct instrument is a vacuous pass plus an early advisory, not an exemption. The ADR needs one revision clause. It is NOT edited by this document: editing an approved `adr` demotes it to `draft` and (per `workflow.review.judgment_required_types`) requires a fresh non-rejecting judgment before it is approved again, which would freeze downstream `task-claim` in the interim. Recorded here so the correction is not lost, and so the ADR edit can be batched with the spec that implements the fix.

Also verified this turn (confirms the ADR's attestation claim): every one of the spec's seven declared script-mode ACs carries `attested_pass >= 2`, so per-claimed-AC attested coverage is 7/7 and the plan closes on its own merits under the new predicate. The repo's `.lore/config.yaml` does NOT set `workflow.attestation.min_ratio`, so the default flip disables the ratio conjunct here rather than silently relaxing an expressed threshold.

## The shared root cause

Every one of the eight findings, plus the correction above, is an instance of:

> **A cheap computable proxy was substituted for the invariant it approximates, and the delta between the two was never represented anywhere in the system.**

Once shipped, the proxy inherits the invariant's full authority: no downstream reader — human, agent, gate, or judge — can distinguish "this predicate measures the invariant" from "this predicate measures something correlated with it". So counter-examples are read as violations of the invariant (false block) or as satisfactions of it (false pass), never as evidence about the proxy.

| Finding | Invariant | Proxy actually measured | Delta surfaces as |
|---|---|---|---|
| §1 | this spec's RELATION to SPEC-080 holds | whether the spec states the relation coherently | false pass — the judge read the claim, never opened SPEC-080 |
| §6 | the verdict covers the whole document | the verdict covers the visible prefix | false pass — truncation disclosed inside one dimension no gate reads |
| §7 | every claimed AC has runner backing | plan-wide attested/total entry RATIO | false block — honest red→green records inflate the denominator |
| §8 | the assessment judged the FINAL state | `assessment_at >= newest evidence timestamp` | false block — a verify that only re-confirms green re-stales it |
| §4 | the task COMPLETED | `git log` shows a commit on the branch | false pass — committed, zero evidence, never released |
| §2 | evidence attests that STATEMENT | evidence references that ID | false pass — same-id re-add makes a wrong pointer look intact |
| §3 | the tests my change affects | diff vs `merge-base main HEAD` | false selection — `main` 28 commits behind, ~130 files chosen |
| §5 | the document is sound | ONE judge sample | both — same bytes, reject(0.72) then approve(0.78) |
| new | the domain doc reflects what this plan landed | content diff in window, absent referent ⇒ violation | false block — no domain doc = nothing to reflect |

## Why it recurs (second-order, ordered by mechanizability)

1. **Decidability drives selection.** The author needs a predicate that computes TODAY; at the moment of substitution the delta exists only in the author's head. A JSDoc note is not a representation: `deriveAttestationSummary`'s own comment states outright that condition 2 "can be satisfied while the guarantee is violated" — that self-admitted delta then ran as the invariant across many plan closes, because nothing downstream reads a comment.
2. **Applicability lives in a DIFFERENT module from the predicate.** "Not applicable" is not a `PredicateResult` value (`{ok:true} | {ok:false,reason,field}` — two states); today it is expressed by the CALLER declining to push the predicate (`checkPlanClose`'s `ctx.prdSyncSynced !== undefined`). So the applicability decision is scattered across `corpus-service.ts`, and a `let synced = false` initializer is enough to route an absent referent into the violating branch. **An unrepresentable verdict gets fused onto whichever existing branch the control flow reaches first.**
3. **Verifier and verified share a lineage.** The judge is an LLM and so is the spec author. "extends X, never duplicating" lands exactly where an LLM reviewer treats a claim as a design decision. Measured: all three cross-spec contradictions were caught by implementers' scoped test runs; zero by a gate or by the judge's own `contract` dimension.

## Mechanization, in priority order (each names its delivery surface)

1. **Three-state predicate result** — `pass | fail | not-applicable(reason, referent)`. TypeScript exhaustiveness then forces EVERY predicate to classify the absent-referent case at compile time; a caller can no longer fuse it onto `fail`. `not-applicable` MUST carry an advisory plus an audit row, so a vacuous pass is never silent. Kills the §4/§7/§8/new class structurally. Surface: `gate-predicates.ts` + `checkpoint-registry.ts` types, `GateEnforcer` translation. Precedent: the same exhaustive-switch discipline already applied to `LoreError`.
2. **Predicate contract table** — every predicate carries `{invariant, measured, known_false_pass[], known_false_block[]}`; a new predicate without one fails typecheck. Rendered by `lore gate --explain <checkpoint>` and quoted in the feeding pack, so an operator blocked on correct work sees the DELTA instead of reaching for an exemption. Surface: registry type + feeding pack + new `--explain` flag.
3. **Verdict scope declaration** — the judge's output carries `scope{docs_in_context[], truncated}`; `lore approve` REFUSES a whole-document verdict with `truncated: true` (degrade to `escalate`, naming unseen sections). Separately: a spec sentence matching `extends|conforms to|per SPEC-\d+` requires a declared link, and the named doc's contract section is fed into the judge's context — otherwise `spec-promote` denies with "you asserted a relation; declare it so it can be checked". This is the SAME scope-declaration discipline the context-provenance feature just shipped for injection payloads, lifted one tier to verdicts.
4. **Criterion supersede path** — `lore ac supersede <spec> <old> --by <new> --reason`: retired criteria keep their text, are excluded from `lore verify`, and old evidence resolves to what it actually attested. `lore ac add` must REJECT an id present in the retired/dangling ref set unless `--supersede-of` is given, making the invisible-wrong-pointer state unreachable.
5. **No environment-encoding defaults** — `test:changed` derives its base from the branch's upstream / a configured integration branch, and FAILS LOUD when the selected file count exceeds a configured ceiling instead of silently selecting the suite. Dispatch bundles pass an explicit base SHA from the template, not from agent judgment.
6. **Two-axis completion** — extend the `subagent-stop` guard's predicate from "committed" to "committed AND (evidence recorded OR explicit blocked report)"; pre-merge verification is git for "did the work land" plus corpus for "did the task complete".

## Standing lesson

When a gate blocks correctly-executed work, or passes work nobody would call verified, ask FIRST whether the predicate measures the invariant or a proxy — and then whether the proxy's delta is written down anywhere a reader will hit it. A ratio, a timestamp window, a count, an id, a single LLM sample, and a commit's existence are all proxies. The durable fix is rarely a better proxy; it is making the invariant's inapplicable and unmeasured cases REPRESENTABLE in the type the predicate returns.
