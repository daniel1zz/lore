---
id: PLAN-102
type: plan
role: plan
title: "Implementation — plan-close predicates measure invariants (applicability type, per-claimed-AC coverage, attributable sync)"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: SPEC-111
phases:
  - {name: "Applicability"}
  - {name: "Coverage core"}
  - {name: "Gate wiring"}
  - {name: "Close-out"}
---
# Implementation — plan-close predicates measure invariants

## Goal

Land every AC of `spec-plan-close-predicates-measure-invariants-an-applicability`: the `PredicateNotApplicable` type split (M0), per-claimed-AC attested coverage with an opt-in ratio (M1), attributable domain-doc sync plus not-applicable-on-absent-referent (M2), the plan-close predicate contract table, and the compiled-binary e2e. Every AC is script-mode, so `lore verify` is the closing oracle.

## Approach (as built — this section was rewritten after execution; see §As-built deviations)

Phases were ordered by the file-anchor dependency graph rather than by conceptual grouping, because `corpus-service.ts`, `gate-predicates.ts` and `checkpoint-registry.ts` are each touched by several slices and cannot be edited concurrently.

| Task | Phase | Scope | ACs |
|---|---|---|---|
| T1 | Applicability | `PredicateNotApplicable` / `ApplicablePredicateResult`, both plan-close consumers, the plan-promote advisory, the not-applicable audit row, `prd-sync-domain-doc.ts` extraction | AC-PCI-1..4 |
| T2 | Coverage core | `deriveClaimedAcCoverage`, `AttestationSummary` extension, `min_ratio` default flip, feeding-pack diagnostics, projection + dashboard render parity | AC-PCI-5..9, 13, 14 |
| T3 | Gate wiring | domain-doc sync attribution; plus the amendment removing `attestationFloor`'s `= []` default (a silent opt-out T2 had introduced) | AC-PCI-10 |
| T4 | Gate wiring | `PREDICATE_CONTRACTS` + `lore gate plan-close --explain`; plus the amendment replacing `checkPlanClose`'s `?? []` fabrication with a companion not-applicable verdict | AC-PCI-11 |
| T5 | Close-out | compiled-binary e2e from a throwaway corpus (clean close with advisory, blocked close naming the AC, control run isolating the cause) | AC-PCI-12 |
| T6 | Close-out | upstream ADR revision clause + `decision_status: accepted` | AC-PCI-15 |
| T7 | Gate wiring | `lore approve` renders `prd_sync_advisories` to stderr — added mid-flight after T1 reported the advisory had a writer but no reader | AC-PCI-16 |
| T8 | Gate wiring | repair of the T3+T4 integration regression (6 under-specified fixtures) + per-referent advisory kind — added after the merge measurably turned AC-PCI-2/3 RED | re-established AC-PCI-2, AC-PCI-3 |

T7 and T8 were not in the original plan. T7 closed a distribution gap (an advisory the CLI never printed); T8 closed a regression that only appeared when two anchor-disjoint branches met. Both are recorded as tasks rather than absorbed silently into another slice.

Concurrency rule used for dispatch: within a phase, tasks' `file_anchors` were verified disjoint before dispatch; across phases they are not, so phases ran strictly sequentially with a merge between them.

## Exit Criteria — measured outcome

| Criterion | Outcome |
|---|---|
| `lore verify <plan>` attests every AC green on a clean tree at a named commit | **MET** — 16/16 attested pass, exit 0, at `8227dd1`; re-run per task so every task carries runner-attested entries |
| `bun run typecheck` clean | **MET** — exit 0, zero `error TS`, measured without a pipe |
| Both test runners green on the full suite, run once from a clean tree after the last merge | **NOT LITERALLY MET** — vitest 401 files / 6816 pass / 0 fail; bun 147 files / 1600 pass / **1 fail**. See §As-built deviations |
| No AC satisfied by an exemption; no `attestation_exempt` / `prd_sync_exempt` / `assessment_freshness_exempt` on this plan | **MET** — no exemption field was written at any point |
| `plan-implementation-context-provenance-scope-declaring` closes under the new predicates with no exemption | Verified after this plan's own close; recorded as evidence rather than asserted |

## As-built deviations (stated, not smoothed over)

1. **The full-suite criterion is not literally satisfied.** The single bun failure is `issue-report-cross-corpus.bun.test.ts` → `AC-072-9` (two concurrent `lore report-issue` invocations; one exits 1). Attribution was measured, not characterised: 1 failure / 10 runs at the pre-slice baseline `17c1a44` versus 1 failure / 9 runs at the merged `8227dd1` — the same ~10% rate on both trees, which also falsified the hypothesis that T1's new `gate_not_applicable` audit row added write contention. The flake is pre-existing and out of this plan's scope; the criterion is recorded as unmet rather than reworded to match the result.
2. **`lore verify --ac` is silently inert.** Per-task attestation runs passed `--ac <id>` to restrict each run to that task's own ACs; every run executed all 16 regardless. The irreversible consequence is that each task's evidence log now carries attested entries for ACs it never claimed — real runner data, but an overstated per-task scope that append-only evidence cannot retract. Recorded as a defect, not worked around.
3. **AC-PCI-15's pinned oracle cannot self-evidence.** `lore get … | grep -q` closes the pipe before `lore` finishes writing, so every recorded `output_tail` is an EPIPE error and the pass rests on an exit code alone. A supplementary `grep -c` run (matches=1) supplies the affirmative capture. The AC itself was not rewritten — it already carried evidence, and rewriting an evidenced AC converts a visible weakness into an invisible one.
4. **Per-worktree evidence outlived its truth across a merge.** AC-PCI-2/3 held pass evidence from T1 while measurably RED at `5fcb07f`. T8 recorded fresh evidence rather than rewriting history. The underlying gap — evidence entries carry no commit provenance, so nothing can detect that a pass was measured on a tree that no longer exists — is a finding for the corpus, not something this plan fixes.

## Risks (as encountered)

- **`corpus-service.ts` contention** — mitigated by phase serialization; held.
- **The byte-pinned feeding-pack tail** — held: T2 inserted before it, T4 declined to touch it from outside its anchors.
- **A newly armed conjunct evaluating old data** — materialised exactly as budgeted: the merge turned two already-passing ACs red, repaired by T8.
- **`test:changed`'s wrong default base** — mitigated by passing an explicit base SHA in every dispatch bundle; no agent derived it.
- **Unbudgeted:** a co-resident session switched the shared checkout to `main` mid-flight, and the `lore` on PATH is a dev symlink into that checkout's `dist/` — so the CLI silently became a build without this plan's work. Integration moved to a dedicated worktree and the gate was exercised with the worktree's own binary.
