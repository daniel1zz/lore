---
id: KN-123
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-064 Dashboard Settings UI (2026-07-22)"
status: approved
priority: medium
created: 2026-07-22
updated: 2026-07-24
tags: []
parent: PLAN-059
links:
  - {id: PLAN-059, type: informs}
---
# Assessment: partially_met (83/100)

Scope: plan `01KY3S6Q5DES1S0A64RYZYEE2H`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-064-1 | 88 | settings-render.pw.ts ran, 5 passed 0 fail (T5 evidence). UI code visible in diff supports the claims: deny rows render text-only via findDeniedConfigKeys, blast-radius disclosure testid present, precedence table marks one effective layer. Self-reported (not attested); spec file itself unseen. | task-skill-test-settings-e2e-suites-render-write (e2e output_tail: 5 passed (48.4s)), task-skill-implement-settings-route-two-scope-ui |
| AC-064-2 | 86 | settings-write.pw.ts ran, 3 passed 0 fail. Minimal-patch construction (buildPatchFromChangedPaths) visibly keeps restart_required honest; conflict path shows modal with no force-overwrite. Self-reported evidence; test file unseen. Note: implementation uses ConfigConflictModal, a sibling of the AC's… | task-skill-test-settings-e2e-suites-render-write (e2e output_tail: 3 passed (36.8s)) |
| AC-064-3 | 92 | global-config.test.ts ran and passed, and the saveGlobalConfig diff is directly inspectable: schema safeParse BEFORE any fs access (0-byte guarantee), mkdirSync recursive for missing XDG parents, tmp-file + renameSync atomicity. Strongest AC — passing oracle plus visible correct implementation. | task-skill-implement-machine-config-write-backend-saveglobalconf (vitest pass + diff shows validate-then-write in config-node.ts) |
| AC-064-4 | 85 | Both halves passed: global-config-service.test.ts (deny-key rejection, CAS in service) and config-routes.test.ts (bearer 403, If-Match 400/409). GlobalConfigService source and both test files are omitted from the diff, so correctness rests on the passing runs; wiring in app.ts and route dispatch is… | task-skill-implement-machine-config-write-backend-saveglobalconf, task-skill-implement-machine-config-http-routes-cookie-only |
| AC-064-5 | 92 | config-precedence.test.ts passed and the module is fully visible: imports mergeDefaults (no re-derivation), ?? not \|\| for falsy color:false, honest absent builtin for editor, fixed 3-row order. Test file unseen but implementation matches the AC's 8-combination contract structurally. | task-skill-implement-config-precedence-pure-contract-core (vitest pass + config-precedence.ts visible in diff) |
| AC-064-6 | 90 | browser-safety.test.ts passed after config-precedence.ts joined the barrel. Diff confirms config-precedence imports only ./config.js (pure), dashboard imports resolveGlobal* helpers only in server-side app.ts via @lore/core/node, and dashboard/src uses @lore/core default barrel only. | task-skill-implement-config-precedence-pure-contract-core (browser-safety scan green) |
| AC-064-7 | 25 | Evidenced FAIL (0 pass, 1 fail): browse-ux/review-loop fail on pre-existing seed debt. Mitigation is documented — failures proven identical at pre-session baseline 1e5ac3c, knowledge doc captured, formally superseded by AC-064-8 — but the AC as worded is contradicted and remains in declared scope (… | task-skill-test-regression-existing-e2e-suites-green (manual evidence: UNSATISFIABLE as worded, baseline-proven pre-existing) |
| AC-064-8 | 90 | Replacement AC: read-flow + write-flow ran and exited 0 (12 tests, output_tail shown), and this is the only ATTESTED pass in the plan (recorder=apple). Baseline-identity claim for the excluded suites is orchestrator-self-reported but specific (commit hash, same 2 test ids). | task-skill-test-regression-existing-e2e-suites-green (attested e2e pass, recorder=apple) |

## Gaps

- AC-064-7 evidenced FAIL (0 pass, 1 fail): browse-ux and review-loop fail on pre-existing spec-create-gate seed debt. Mitigation exists — failures proven identical at pre-session baseline 1e5ac3c, superseded by AC-064-8 (attested pass) — but the plan declares no ac_scope, so the unsatisfiable AC remains formally in scope and unfixed.
- The security-critical AC (deny-key rejection, in-service CAS, bearer→403 on machine PATCH) is verified only by agent-self-reported vitest passes; both production files (global-config-service.ts, config-routes.ts) and both test files are omitted from the reviewable diff, so INV-1/INV-6 cannot be independently confirmed from source.
- Attested evidence ratio is 0.06 across the plan — only the AC-064-8 regression run (recorder=apple) is human-attested; all other oracle results, including the UAT verdict, are recorded by the executing agents themselves.
- Plan T4 approach and AC-064-2 wording say 'reuse ConflictModal (SPEC-022)'; the implementation instead created a distinct ConfigConflictModal (data-testid config-conflict-modal). The divergence is well-reasoned in the component header (no DocRecord/diff, no force-overwrite path) but was not reflected back into the plan/AC text.
- UAT accepted with two dimensions at the floor (3): config inputs lack programmatic labels (aria-label/htmlFor — screen-reader gap) and validation errors surface a bare 'Required' without naming the field. No P0, but both are user-visible quality debt in the shipped surface.

## Recommendations

- Formalize AC supersession: when an AC is proven unsatisfiable and replaced (AC-064-7→AC-064-8), record the exclusion in extra.ac_scope so deterministic coverage tables stop reporting an in-scope fail.
- Require human (or at least cross-agent) attestation for ACs guarding security invariants — here AC-064-4's bearer→403 and deny-key enforcement — rather than accepting the implementing agent's own recorded pass.
- Open a follow-up task for the UAT score-3 items: add programmatic labels to config inputs and field-named validation messages.
- Pay down the browse-ux/review-loop seed-gate debt (spec-create gate on bare specs) so the full 4-suite dashboard regression gate is usable again by future plans.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 128847ms
- Retried: false
- Truncated sections: diff:packages/core/src/config-precedence.test.ts, diff:packages/dashboard/tests/e2e/settings-render.pw.ts, diff:packages/dashboard/tests/e2e/settings-write.pw.ts, diff:packages/lore/src/adapters/http/config-routes.ts, diff:packages/lore/src/service/global-config-service.ts, diff:packages/lore/tests/unit/adapters/http/config-routes.test.ts, diff:packages/lore/tests/unit/core/global-config.test.ts, diff:packages/lore/tests/unit/service/global-config-service.test.ts
- Reasoning clipped for: AC-064-2, AC-064-4, AC-064-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.8 | evidence | 7 of 8 ACs pass their script oracles; visible diff (saveGlobalConfig, config-precedence, Settings UI) matches spec invariants. AC-064-7 fails as worded but is baseline-proven pre-existing and superse… |
| evidence_integrity | 68 | 0.7 | evidence | Every task has oracle evidence with commands and some output tails, but attested ratio is 0.06 — nearly all passes are agent-self-reported; 8 changed files (2 prod, 6 test) unseen in the diff. |
| scope_fidelity | 85 | 0.75 | evidence | Diff maps cleanly onto declared tasks T1-T4; additive route registration; no unexplained files. Minor drift: new ConfigConflictModal instead of the planned ConflictModal reuse (rationale documented). |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-064-7 | AC-064-7 evidenced FAIL (0 pass, 1 fail): browse-ux and review-loop fail on pre-existing spec-create-gate seed debt. Mitigation exists — failures proven identical at pre-session baseline 1e5ac3c, superseded by AC-064-8 (attested pass) — but the plan declares no ac_scope, so the unsatisfiable AC remains formally in scope and unfixed. |
| evidence_integrity | minor | AC-064-4 | The security-critical AC (deny-key rejection, in-service CAS, bearer→403 on machine PATCH) is verified only by agent-self-reported vitest passes; both production files (global-config-service.ts, config-routes.ts) and both test files are omitted from the reviewable diff, so INV-1/INV-6 cannot be independently confirmed from source. |
| evidence_integrity | minor | — | Attested evidence ratio is 0.06 across the plan — only the AC-064-8 regression run (recorder=apple) is human-attested; all other oracle results, including the UAT verdict, are recorded by the executing agents themselves. |
| scope_fidelity | minor | AC-064-2 | Plan T4 approach and AC-064-2 wording say 'reuse ConflictModal (SPEC-022)'; the implementation instead created a distinct ConfigConflictModal (data-testid config-conflict-modal). The divergence is well-reasoned in the component header (no DocRecord/diff, no force-overwrite path) but was not reflected back into the plan/AC text. |
| outcome | minor | — | UAT accepted with two dimensions at the floor (3): config inputs lack programmatic labels (aria-label/htmlFor — screen-reader gap) and validation errors surface a bare 'Required' without naming the field. No P0, but both are user-visible quality debt in the shipped surface. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Formalize AC supersession: when an AC is proven unsatisfiable and replaced (AC-064-7→AC-064-8), record the exclusion in extra.ac_scope so deterministic coverage tables stop reporting an in-scope fail. | The current table permanently shows a failing declared AC, forcing every downstream auditor to re-litigate the supersession narrative. |
| process | Require human (or at least cross-agent) attestation for ACs guarding security invariants — here AC-064-4's bearer→403 and deny-key enforcement — rather than accepting the implementing agent's own recorded pass. | R-1 names machine-wide write blast radius as the top risk; a 0.06 attestation ratio leaves its key control self-certified. |
| plan | Open a follow-up task for the UAT score-3 items: add programmatic labels to config inputs and field-named validation messages. | Both were accepted only because they cleared the min-score bar; they are concrete, cheap fixes to real a11y/copy defects. |
| process | Pay down the browse-ux/review-loop seed-gate debt (spec-create gate on bare specs) so the full 4-suite dashboard regression gate is usable again by future plans. | Two of four regression suites are currently unusable as oracles, weakening every future dashboard change's regression story. |

## Unverifiable Materials

- packages/lore/src/service/global-config-service.ts and packages/lore/src/adapters/http/config-routes.ts: Omitted from diff per truncation manifest — INV-1 single deny SSOT, in-service CAS, and cookie-only PATCH could not be source-verified, only inferred from passing tests.
- All 6 test/e2e files (settings-render/write.pw.ts, global-config.test.ts, global-config-service.test.ts, config-routes.test.ts, config-precedence.test.ts): Omitted from diff — assertion strength behind each passing oracle run cannot be inspected.
- Pre-session baseline claim at commit 1e5ac3c (AC-064-7 failures pre-existing): Orchestrator-self-reported in manual evidence; no independent attestation or baseline run output provided.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 7 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.06
