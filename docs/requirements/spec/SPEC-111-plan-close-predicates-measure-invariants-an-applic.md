---
id: SPEC-111
type: spec
role: spec
title: "plan-close predicates measure invariants: an applicability verdict in the type, per-claimed-AC attested coverage, and attributable domain-doc sync"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PRD-001
links:
  - {id: ADR-017, type: implements}
  - {id: ADR-001, type: informs}
  - {id: KN-326, type: relates-to}
  - {id: KN-327, type: relates-to}
---
# plan-close predicates measure invariants: an applicability verdict in the type, per-claimed-AC attested coverage, and attributable domain-doc sync

## Overview

Three `plan-close` mechanism defects share one root cause: a cheap computable proxy was substituted for the invariant it approximates, and the delta was representable nowhere in the system (`knowledge-root-cause-synthesis-the-eight-dogfooding-findings`). This spec fixes the two proxies named by `adr-plan-close-predicates-must-measure-invariants-not-proxies`, and closes the structural hole that let the third one exist — a predicate cannot today say "my referent is absent, so I do not apply", so an absent referent gets fused onto whichever branch the caller's control flow reaches first.

Goal, in one sentence per mechanism:

- **M0 (structural).** Make "not applicable" a value a predicate returns, not a decision a caller improvises. `PredicateNotApplicable` has no `ok` field, so every consumer of a possibly-inapplicable predicate is a compile error until it handles the third case. An inapplicable verdict is never silent: it emits a `plan-promote` advisory and an audit row.
- **M1.** `attestationFloor` gates on per-claimed-AC attested coverage (the invariant) instead of a plan-wide attested-entry ratio (a proxy that rewards re-running a green oracle and punishes honest red→green records). The ratio survives as an opt-in conjunct, default off, explicit settings preserved.
- **M2.** `prdOutlineSynced` requires the in-window domain-doc edit to be ATTRIBUTABLE to the closing plan, killing the concurrent-session false pass; and an absent domain doc becomes M0's not-applicable instead of a violation.

## Relation to upstream decisions (dereferenced, not asserted)

Per `knowledge-gates-and-the-review-judge-validate-a-spec-against` §1, a claim of the form "extends X" is an unverified claim unless the claimed relation is declared as a link AND X's text was actually read. Both upstream documents below were read in full before this spec was authored; each relation is declared as a link on this doc.

**`adr-plan-close-predicates-must-measure-invariants-not-proxies` (implements, with one correction).** M1 implements its item 1 verbatim, including the scoping-to-claimed-ACs rationale, the retention of `min_ratio` as an opt-in AND-ed conjunct, and the migration rule that an explicitly-set threshold is never silently relaxed. M2's attribution conjunct implements its item 2(a).

This spec CONTRADICTS that ADR in exactly one place, stated plainly rather than glossed. The ADR attributes the observed `prdOutlineSynced` block on `plan-implementation-context-provenance-scope-declaring` to the window proxy ("a plan that legitimately introduces no domain-level capability has nothing to write"), and concludes that mechanism-fix plans "still need `prd_sync_exempt`". Measured 2026-07-30: the ancestor spec's `parent_id` is the root PRD (type `prd`) and it declares no `implements` edge to a spec, so `resolvePrdSyncDomainDoc` returns `ok(null)` — a fact its own JSDoc calls "a FACT, never an error" — and `CorpusService.set`'s `let synced = false; if (domainDoc !== null) {…}` then routes that fact into the violating verdict. The proximate cause was domain-doc ABSENCE, not a missing in-window edit. Consequence: for a plan whose ancestor spec has no domain doc the correct instrument is M0's not-applicable plus an early advisory, and no exemption is needed. The ADR's own §Consequences needs this one revision clause; it is applied in the same slice that lands this spec, so the corrected decision and its implementation are never separated.

**`adr-ac-as-code-oracle` (informs).** Its decision already establishes that per-AC coverage is computed by a pure function from evidence and NEVER persisted ("镜像 computed readiness"), and that judgment is rendered against the DECLARED criterion set ("assess 按声明集裁决:judge 的 `ac_scores[].ac_id` 必须 ⊆ 声明集"). M1's claimed-AC set is the intersection of the plan's evidence `ac_ref`s with the governing spec's declared script-mode criteria — an application of that existing coordinate-system rule, not a new one, and the reason a dangling `ac_ref` (an id no longer declared, per that retro's §2) can never become a permanent false block.

## Scope

In scope, by file:

- `packages/lore/src/service/gate-predicates.ts` — `PredicateNotApplicable` / `ApplicablePredicateResult` types, `NOT_APPLICABLE_REASONS`; `attestationFloor` and `prdOutlineSynced` signatures.
- `packages/lore/src/service/checkpoint-registry.ts` — `GateContext` raw-fact fields, `checkPlanClose` narrowing, `feedAttestationFloor` diagnostics, the plan-promote domain-doc advisory, `PREDICATE_CONTRACTS`.
- `packages/lore/src/service/gate-enforcer.ts` — not-applicable collection into the advisory channel plus a best-effort audit row; typed advisory kinds.
- `packages/lore/src/service/corpus-service.ts` — plan-close ctx assembly stops collapsing `null` into `false`; claimed-AC coverage facts; domain-doc attribution.
- `packages/lore/src/service/review-service.ts` — plan-promote advisory surfacing, keyed by advisory kind.
- `packages/core/src/evidence-panel.ts` — `deriveClaimedAcCoverage`, `AttestationSummary` extension.
- `packages/core/src/config.ts` — `workflow.attestation.min_ratio` becomes optional (no Zod default); `resolveAttestationMinRatio` returns `number | null`.
- `packages/lore/src/service/verification-projection-service.ts` + `packages/dashboard/src/components/evidence/PlanAttestationPanel.tsx` — render parity with the gate's verdict.
- `packages/lore/src/adapters/cli/commands/gate.ts` — `lore gate --explain <checkpoint>`.

Out of scope (named, not deferred silently):

- The `plan-promote` domain-affecting DECLARATION the ADR defers (its own §Decision item 2 records the cost and the failure mode). Unchanged by this spec.
- Extending `PREDICATE_CONTRACTS` beyond the `plan-close` checkpoint's own field set. The table is exhaustive over `plan-close` by construction (a compile error names any uncovered field); other checkpoints join it when they are next touched. This is a checkpoint-scoped mechanism that is complete for its scope, not a half-built one.
- Converting the other ~28 predicates to `ApplicablePredicateResult`. A predicate that cannot be structurally inapplicable keeps `PredicateResult` unchanged — the type split exists precisely so that this migration is zero-churn for them.
- The remaining findings in `knowledge-root-cause-synthesis-the-eight-dogfooding-findings` §Mechanization items 3-6 (verdict scope declaration, criterion supersede path, `test:changed` base derivation, two-axis completion). Recorded there; not this slice.

## Design Decisions

### D1 — `notApplicable` is a member without an `ok` field, deliberately

`PredicateResult` stays `{ok: true} | {ok: false, reason, field}` and is NOT renamed. The third state is a separate interface carrying `notApplicable: true`, a typed `reason`, and the `referent` that was absent:

```ts
export type NotApplicableReason = "referent-absent" | "no-evidence";
export interface PredicateNotApplicable {
  readonly notApplicable: true;
  readonly reason: NotApplicableReason;
  readonly referent: string;
}
export type ApplicablePredicateResult = PredicateResult | PredicateNotApplicable;
```

Rationale for the shape, over two rejected alternatives:

- **Rejected: a third `ok` value (`ok: "not-applicable"`).** `"not-applicable"` is truthy, so every existing `if (!result.ok)` would route it into the PASS path — a silent vacuous pass, the exact defect class being fixed.
- **Rejected: renaming `ok` to a three-valued `status`.** It does force every site to be re-examined, but it churns ~128 sites across 7 modules and 24 test files for the 26 predicates that can never be inapplicable, and a mass mechanical edit over the gate layer is itself a risk surface.
- **Adopted.** Because `PredicateNotApplicable` has no `ok` property, reading `.ok` off an `ApplicablePredicateResult` is a TypeScript error on the union — the compiler forces every consumer of a possibly-inapplicable predicate to narrow, while predicates that cannot be inapplicable are untouched. Same compile-time forcing, blast radius proportional to the actual change.

### D2 — an inapplicable verdict is loud on two channels

`GateEnforcer.enforce` never denies on a not-applicable result. It (a) collects it into the advisory channel, and (b) writes a best-effort, never-blocking audit row (mirroring the existing config-disabled `gate_skipped` row — observability never changes the outcome). Advisories become typed at the enforcer boundary — `{kind: "verify-reachability" | "prd-sync-domain-doc" | "attestation-not-applicable", message}` — so `ReviewService.approve`'s shipped `reachability_advisories` field keeps its exact meaning and the new classes arrive on their own keys instead of silently widening an existing one.

The `plan-promote` advisory is where the domain-doc signal belongs, per the ADR's own reasoning that a plan with nothing to verify must be flagged when it is promoted, not discovered at close. It names the ancestor spec and the wiring command. The close-time audit row exists so the vacuous pass is never invisible to an auditor.

### D3 — `attestationFloor`'s conditions after M0 + M1

Three independent conditions; any failure blocks:

1. every task carrying ANY `verification_evidence` carries ≥1 runner-attested entry (unchanged per-task backstop);
2. **new, and the default teeth:** every CLAIMED-AND-ATTESTABLE AC has ≥1 runner-attested entry;
3. the plan-wide attested ratio ≥ `min_ratio` — **only when `min_ratio` is explicitly configured**, AND-ed with 1 and 2, never a substitute.

"Claimed and attestable" = an AC id that (a) the governing spec declares, (b) declares in `verify.mode === "script"`, and (c) at least one of the plan's tasks' evidence entries references via `ac_ref`. (a) excludes dangling refs left by a removed AC — an AC that no longer exists cannot be re-verified, so demanding its attestation would be a permanent false block. (b) excludes `ai`/`human`-mode ACs, which `lore verify` structurally cannot attest, for the same reason. (c) is the ADR's deliberate scoping: a phased or partial-delivery plan legitimately claims a subset, and blocking it for ACs it never claimed is a false block. Spec-level completeness across all child plans remains a different question at a different tier.

"≥1 runner-attested entry" counts `attested_pass + attested_fail`, not `attested_pass` alone. An `expected-fail` or `fail` result that a runner produced still proves the runner ran that AC's registered command, which is what THIS predicate measures; whether the AC is green is `lore verify`'s and the assessment's business. Requiring `attested_pass` here would false-block a legitimately red-then-fixed AC whose last runner row is a fail, and would double-count a concern another predicate already owns.

A plan with zero evidence anywhere is `notApplicable("no-evidence")` rather than today's silent vacuous pass — a plan closing with no verification evidence at all is exactly the case that should surface an advisory.

### D4 — the ratio's default flips to off, and an explicit setting is never relaxed

`workflow.attestation.min_ratio` loses its Zod `.default(0.5)` and becomes optional; `resolveAttestationMinRatio` returns `number | null`. Absent ⇒ `null` ⇒ condition 3 does not run. Explicitly set ⇒ enforced exactly as before, AND-ed with conditions 1-2. This is the only shape that satisfies the ADR's migration rule, because a Zod default makes "absent" and "explicitly 0.5" indistinguishable at every read site.

`AttestationSummary.min_ratio` therefore becomes `number | null`, and the dashboard panel must render a disabled conjunct AS disabled — never as `0`, which would read as "0% required" and never as `0.5`, which would claim an enforcement that is not happening.

### D5 — the feeding pack gains the AC diagnostics without disturbing its byte-pinned tail

`feedAttestationFloor`'s REACHABLE branch has a byte-identical regression pin from `Recovery: run \`lore verify …\`` through the end (AC-VRW-2, `feed-attestation-reachability.test.ts`). Every new diagnostic — the unattested claimed-AC ids, and the ratio line only when condition 3 is actually enabled — is inserted BEFORE that sentence. When the ratio conjunct is off, the pack must NOT print a ratio-vs-floor line at all: naming a cause that is not enforcing is the misdirection this whole spec is about.

### D6 — attribution for `prdOutlineSynced`, and what it cannot do

An in-window domain-doc content diff satisfies the predicate only when it is ATTRIBUTABLE to the closing plan. Either attributor suffices:

- the qualifying update's raw submitted content contains the closing plan's slug or id, or the governing spec's slug or id; or
- a `relates-to` or `informs` link edge (either direction) exists between the domain doc and the closing plan, or between the domain doc and the governing spec.

Structural relations — the domain doc being the spec's `parent_id`, or the spec's `implements` edge to it — are explicitly NOT attributors: they are the very relations `resolvePrdSyncDomainDoc` used to FIND the domain doc, so accepting them would make the conjunct vacuously true and reproduce the defect being fixed.

Residual weakness, stated because the ADR's own text admits spec-level attribution: a sibling plan under the SAME governing spec can satisfy a spec-level attributor, so attribution discriminates plan-vs-plan only via the plan-level attributors. Plan-level attribution is strictly stronger and is what kills the measured concurrent-session false pass; spec-level is accepted per the ADR and recorded here as the known residual rather than presented as full attribution.

### D7 — the predicate contract table

`PREDICATE_CONTRACTS: Record<PlanCloseField, PredicateContract>` where `PredicateContract = {invariant, measured, known_false_pass: string[], known_false_block: string[]}` and `PlanCloseField` is the union of the `*_FIELD` constants `checkPlanClose` can emit. Exhaustive by construction: adding a plan-close predicate without a contract fails typecheck. Rendered by `lore gate --explain <checkpoint>` and quoted into the feeding pack, so an operator blocked on correct work reads the delta instead of reaching for an exemption. An empty `known_false_*` array means "none recorded", never "none exist" — the table's own doc comment says so, because the alternative is a fresh proxy for completeness.

## Acceptance Criteria

Structured criteria are authored via `lore ac add` (below); the prose here is a summary, the typed criteria are the contract.

- Absence of a referent never renders as a violation, on any plan-close predicate.
- A claimed script-mode AC with zero runner-attested evidence blocks the close, and is named in the feeding pack.
- A plan whose development-time self-reported evidence dominates its trail, but whose every claimed AC is attested, closes with no exemption and no config change.
- An explicitly configured `min_ratio` keeps enforcing across the default flip.
- An in-window domain-doc edit that names neither the plan nor its spec, and carries no `relates-to`/`informs` edge, no longer satisfies the sync predicate.
- Every plan-close predicate's invariant, measurement, and known deltas are machine-readable and rendered by `lore gate --explain`.

## Migration

1. `min_ratio` absent from a config ⇒ condition 3 stops running. On this repo's own corpus that is the intended relaxation (the corpus sets no `min_ratio`); a team that had relied on the 0.5 default and wants it back writes it explicitly, and `lore gate --explain plan-close` states which conjuncts are live.
2. No stored data changes. Claimed-AC coverage is computed at gate time from evidence and declared criteria, never persisted (`adr-ac-as-code-oracle`).
3. Plans already closed are unaffected; the gate evaluates only at the archival transition.
4. A newly armed conjunct evaluates against data authored under the old rules (`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`). Condition 2 is the newly armed one: a pre-existing OPEN plan with a claimed-but-unattested AC will block at its next close attempt, with the AC named and `lore verify <plan>` as the recovery. That is a one-time sweep on open plans only, and the recovery is a real oracle run, never a synthesized artifact.


## Acceptance Criteria (structured)

- [⚑] [script] AC-PCI-1: prdOutlineSynced given an absent domain doc returns a PredicateNotApplicable value: notApplicable === true, reason === 'referent-absent', a non-empty referent, and NO 'ok' property (asserted via "ok" in result === false).
  script: test — bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts -t 'notApplicable shape'
- [⚑] [script] AC-PCI-2: checkPlanClose given a plan-close ctx whose domain doc is absent returns a results array containing NO entry with field 'prd-outline-synced' and no ok:false entry attributable to prd_sync; the not-applicable verdict is returned on its own channel.
  script: test — bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts -t 'never a fail'
- [⚑] [script] AC-PCI-3: GateEnforcer.enforce('plan-close', ctx) with an absent domain doc returns ok (never a deny) AND records one best-effort audit row naming the absent referent; a throwing audit writer leaves the enforce result unchanged.
  script: test — bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts -t 'enforce advisory'
- [⚑] [script] AC-PCI-4: ReviewService.approve on a plan-promote whose ancestor spec resolves no domain doc while prd_sync is enabled returns a prd_sync advisory naming that spec's slug and the lore link wiring command, on a key distinct from reachability_advisories; a resolvable domain doc yields no such advisory.
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-promote-prd-sync-advisory.test.ts -t 'promote advisory'
- [⚑] [script] AC-PCI-5: deriveClaimedAcCoverage returns claimed_acs containing exactly the script-mode declared criteria carrying at least one evidence ref: an ai-mode and a human-mode criterion with refs are excluded, and an evidence ac_ref naming an undeclared id never appears in claimed_acs or unattested_acs.
  script: test — bunx vitest run packages/core/src/evidence-panel.test.ts -t 'claimed set'
- [⚑] [script] AC-PCI-6: deriveAttestationSummary returns meets_floor false for a fixture where every evidence-bearing task has at least one attested entry AND the ratio meets an explicit min_ratio, but one claimed script-mode AC has zero attested refs; unattested_acs names exactly that AC id.
  script: test — bunx vitest run packages/core/src/evidence-panel.test.ts -t 'coverage conjunct'
- [⚑] [script] AC-PCI-7: resolveAttestationMinRatio returns null for a config declaring no workflow.attestation.min_ratio, and a plan whose attested ratio is 0.36 with every claimed AC attested transitions to archived through the real plan-close gate with no exemption field set.
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t 'ratio disabled'
- [⚑] [script] AC-PCI-8: A config explicitly setting workflow.attestation.min_ratio to 0.5 still denies the same 0.36-ratio plan (ratio conjunct AND-ed with per-AC coverage), and an explicit 0 permits it; both paths exercise CorpusService.set's real gate rather than the predicate in isolation.
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t 'explicit ratio'
- [⚑] [script] AC-PCI-10: An in-window domain-doc content diff whose submitted content names neither the closing plan nor its governing spec, with no relates-to or informs edge to either, denies plan-close; the same edit passes once the plan slug appears in the content, and passes via a relates-to edge to the plan; a parent_id or implements structural relation alone never satisfies attribution.
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-prd-sync.test.ts -t 'attribution'
- [⚑] [script] AC-PCI-11: PREDICATE_CONTRACTS declares an entry for every field checkPlanClose can emit (asserted by comparing the table's key set against the emitted-field constants), and lore gate --explain plan-close prints each predicate's invariant, measured proxy, and known_false_pass/known_false_block entries.
  script: test — bunx vitest run packages/lore/tests/unit/service/predicate-contracts.test.ts -t 'contract table'
- [⚑] [script] AC-PCI-12: From a throwaway corpus driven by the compiled dist/lore binary: a plan whose single claimed AC carries attested evidence, whose ancestor spec has no domain doc, and whose config sets no min_ratio, archives at exit 0 with the not-applicable advisory printed; a sibling plan with an unattested claimed AC exits 4 with that AC id in the output.
  script: e2e — cd packages/lore && bun test tests/e2e/plan-close-invariants-compiled.bun.test.ts -t 'compiled close'
- [⚑] [script] AC-PCI-9: The attestation-floor feeding pack names every unattested claimed AC id; it contains the literal substring 'attested ratio' when min_ratio is explicitly configured and does NOT contain that substring when min_ratio is unconfigured; feed-attestation-reachability.test.ts's byte-pinned Recovery tail still passes unchanged.
  script: test — bunx vitest run packages/lore/tests/unit/service/feed-attestation-ac-diagnostics.test.ts packages/lore/tests/unit/service/feed-attestation-reachability.test.ts -t 'unattested naming'
- [⚑] [script] AC-PCI-13: VerificationProjectionService's plan panel passes a null min_ratio through verbatim (never coerced to 0 or a numeric default) and its claimed-AC coverage field equals deriveClaimedAcCoverage over computeAcCoverage's own output for the same fixture, so the panel and the gate cannot disagree.
  script: test — bunx vitest run packages/lore/tests/unit/service/verification-projection-service.test.ts -t 'ratio disabled render'
- [⚑] [script] AC-PCI-14: PlanAttestationPanel renders the literal text 'ratio conjunct disabled' when min_ratio is null and renders the numeric floor when it is set; the null case's rendered output contains neither '0%' nor '50%'.
  script: test — cd packages/dashboard && bunx vitest run tests/component/PlanAttestationPanel.test.tsx -t 'ratio disabled render'
- [⚑] [script] AC-PCI-15: The upstream ADR carries its revision clause: lore get adr-plan-close-predicates-must-measure-invariants-not-proxies emits a line starting with '## Revision 2026-07-30', so the corrected decision cannot land without the ADR that states it.
  script: other — lore get adr-plan-close-predicates-must-measure-invariants-not-proxies | grep -q '^## Revision 2026-07-30'
- [⚑] [script] AC-PCI-16: lore approve prints every prd_sync_advisories entry to stderr (never stdout) with an unchanged exit code 0, keeps that rendering distinct from the reachability_advisories loop, and prints nothing when both fields are absent.
  script: test — bunx vitest run packages/lore/tests/unit/cli/approve-advisory-render.test.ts -t 'advisory render'
- [·] [script] AC-PCI-17: checkPlanClose emits a BLOCKING failure (not an advisory) for a plan-close ctx whose declared-scope coverage conjunct is notApplicable('scope-undeclared') while at least one of the plan's tasks carries verification evidence — the exact input shape that archived four plans at exit 0 on 2026-07-31
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts -t 'PCI-17'
- [·] [script] AC-PCI-18: CONTROL: the same plan with extra.ac_scope declared on its evidence-bearing tasks and attested coverage still passes checkPlanClose with zero blocking failures — AC-PCI-17's deny is conditional on the UNDECLARED scope, not on the presence of evidence
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts -t 'PCI-18'
- [·] [script] AC-PCI-19: CONTROL: a plan whose tasks carry ZERO evidence still closes — attestationFloor's notApplicable('no-evidence') stays advisory, proving AC-PCI-17 did not break the pure-planning close path
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts -t 'PCI-19'
- [·] [script] AC-PCI-20: A plan-close run in which EVERY blocking conjunct returned notApplicable reports that vacuity as a literal string on the gate's own output surface, asserted by string equality and never inferred from an empty failure list; a run with at least one applicable conjunct does NOT carry that string
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts -t 'PCI-20'
- [·] [script] AC-PCI-21: From a throwaway corpus driven by the compiled dist/lore binary: archiving a plan whose tasks carry evidence and declare no ac_scope exits NONZERO and names the missing declaration, while the same corpus's zero-evidence plan still archives at exit 0
  script: e2e — cd packages/lore && bun test tests/e2e/plan-close-invariants-compiled.bun.test.ts -t 'PCI-21'
