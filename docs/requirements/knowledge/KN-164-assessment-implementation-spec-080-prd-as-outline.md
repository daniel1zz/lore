---
id: KN-164
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-080 PRD-as-outline contract (2026-07-26)"
status: draft
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
links:
  - {id: PLAN-031, type: informs}
---
> ⚠ INVALIDATED 2026-07-26T08:13:27.278Z — superseded by knowledge-assessment-implementation-spec-080-prd-as-outline; Duplicate: orchestrator double-ran lore assess (second run chained only to capture a clean exit code); the first run's doc is canonical — identical range, same session

# Assessment: partially_met (79/100)

Scope: plan `01KYEH9MDRVN9WEZ61M43FK5EJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-080-1 | 88 | prd-budget-check.bun.test.ts attested pass twice (5 pass/0 fail); live corpus PRD raw body 16808 <= 24000 and --check-prd-budget exit 0 recorded, but the live-corpus half is self-reported main-orchestrator e2e, not attested. | 01KYEHAWZ73JG2B2VQQJKZXG8M (T9 attested runs [6][16]), 01KYEHQB7FRNQWA3EG9K9H738A (T7b live 16808 chars, self-reported) |
| AC-080-2 | 92 | outline-writer-guard.test.ts 15/15, attested pass twice at close-out; T2r RED→T2 GREEN pair intact; CorpusService.set regression suites (77+7) green. Dedicated-verb guard evidenced end-to-end. | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [1][11]), 01KYEHAVSBVS6MCT1ZMJGGBR9W (T2 implementation evidence) |
| AC-080-3 | 78 | Two attested FAILs: the AC-bound oracle file was never written despite T1 self-reporting a manual pass. Remediated in-session — test authored, then 2 attested passes (happy/negative/boundary). Real integrity miss, caught and closed. | 01KYEHAWZ73JG2B2VQQJKZXG8M (fails [2][12], remediated passes [21][22], verify note [26]) |
| AC-080-4 | 90 | plan-close-prd-sync.test.ts 11/11 attested twice; T5r RED (8 fail for missing predicate) → T5 GREEN; SPEC-054/069 sibling gates re-run green. Knob-OFF regression posture evidenced by unchanged pre-existing suites. | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [7][17]), 01KYEHAV04PSHJH3NT8PR5HC0V (T5 evidence) |
| AC-080-5 | 90 | status-exempt-surfacing.test.ts 6/6 attested twice, covering exempt_plans projection plus render-layer byte-stability for zero exemptions. Paired RED evidence present. | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [3][13]) |
| AC-080-6 | 90 | prd-budget-content-flight.test.ts 17/17 attested twice; T4 evidence records matched-count verification (17 it() blocks) against the fixture, boundary + typed-schema-never-flagged cases named. | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [8][18]) |
| AC-080-7 | 90 | outline-migration-dryrun.bun.test.ts attested twice; output names char-coverage/section-ref/R-id set-equality verdicts and asserts zero writes on both happy and violation fixtures. RED was module-missing, not assertion-shaped. | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [4][14]) |
| AC-080-8 | 92 | bootstrap-outline-payload.bun.test.ts 4/4 attested twice (sub-32000 fixture pin + <10% of full-prose size), plus the live-corpus pin `lore bootstrap --json \| wc -c` = 9208 chars recorded at close-out. | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [5][15]; live pin [25]) |
| AC-080-9 | 87 | Composite e2e attested twice (playwright + bootstrap --json + --check-requirements), plus a clean unpiped 41-pass rerun and full suites 1257 pass/0 fail. Tail output truncated, so only the passing prefix is directly visible. | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [9][19]; [23][24]) |
| AC-080-10 | 90 | `-t detail-link` attested twice, 3 matched tests: zero rel=detail links → exit 3, detail link to soft-deleted doc → exit 3, compliant → exit 0. T4 records matched-count 3 against declared it() blocks (no vacuous filter). | 01KYEHAWZ73JG2B2VQQJKZXG8M (attested [10][20]) |

## Gaps

- Unexplained drift: NewDocModal combobox + parent-suggestions.ts, PendingPanel/TriageQueue review-queue merge + review-queue.ts, PhaseProgressPanel declared-phase union + extractDeclaredPhases, and session.ts buildBootstrapInjection/config.ts bootstrap_injection budgets are all in the diff but map to no T1-T9 task, anchor, or Decisions Log entry. They cite dogfood ISSUE-004/008 and a phase-status ADR, i.e. other work streams.
- session.ts and config.ts document buildBootstrapInjection/resolveBootstrapInjectionBudgets as 'SPEC-080 §Projection Contract, §Public Interface, §Design Decisions D1-D8'. The SPEC-080 in this bundle is the PRD-as-outline contract (C1-C4, AC-080-1..10) with no such sections. The citation cannot be reconciled from the materials provided.
- T1 self-reported AC-080-3's CLI half as manually verified on a throwaway corpus, but the AC-bound persistent oracle file (tests/integration/cli-domain-overview-kind.bun.test.ts) did not exist — two attested FAIL records confirm it. Remediated within the session, but it demonstrates self-reported task evidence passing while the AC's actual oracle was absent.
- The live-corpus half of AC-080-1 (raw body <= 24000, --check-prd-budget exit 0) and T7a/T7b's migration invariants (I3 id/slug preservation, 9 approved children, ADR informs-links) rest entirely on self-reported main-orchestrator e2e/manual records; no attested oracle re-runs the live-corpus assertions.
- T8 (authoring-surface sync) has a single oracle=manual grep/manifest line and records typecheck exit 2 in its worktree, attributed to a sibling agent's WIP via git-stash A/B. No post-merge re-verification of T8's own AC is recorded.

## Recommendations

- Either move the dashboard (ISSUE-004/008, phase-status ADR) and bootstrap-injection changes into their own plans, or add tasks + Decisions Log entries covering them here. As-is the diff cannot be attributed to this plan's declared scope.
- Reconcile the SPEC-080 section references in packages/core/src/session.ts and config.ts (§Projection Contract, §Public Interface, D1-D8) with the spec's actual C1-C4 structure; fix whichever side is wrong.
- Make task close assert that each AC's declared script oracle FILE exists and its command exits 0, before accepting self-reported completion.
- Add an attested oracle for live-corpus assertions (root PRD raw size, id/slug invariance, --check-prd-budget exit code) rather than accepting main-orchestrator transcript records.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 85729ms
- Retried: false
- Truncated sections: diff:.lore/audit-anchor.json, diff:CLAUDE.md, diff:assets/hooks/session-start-resume.mjs, diff:assets/project/pre-push, diff:assets/skills/lore-product/SKILL.md, diff:hooks/pre-push, diff:packages/core/tests/unit/bootstrap-injection.test.ts, diff:packages/dashboard/CLAUDE.md, diff:packages/dashboard/src/lib/parent-suggestions.ts, diff:packages/dashboard/src/lib/review-queue.ts, diff:packages/dashboard/tests/component/NewDocModal.test.tsx, diff:packages/dashboard/tests/component/PendingPanel.test.tsx, diff:packages/dashboard/tests/component/PhaseProgressPanel.test.tsx, diff:packages/dashboard/tests/component/TriageQueue.test.tsx, diff:packages/dashboard/tests/unit/lib/parent-suggestions.test.ts, diff:packages/dashboard/tests/unit/lib/review-queue.test.ts, diff:packages/lore/src/adapters/cli/CLAUDE.md, diff:packages/lore/src/adapters/cli/commands/bootstrap.ts, diff:packages/lore/src/adapters/cli/commands/gate.ts, diff:packages/lore/src/adapters/cli/commands/migrate.ts, diff:packages/lore/src/adapters/cli/commands/outline.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/adapters/cli/gate-bypass-audit.ts, diff:packages/lore/src/adapters/cli/index.ts, diff:packages/lore/src/adapters/http/auth.ts, diff:packages/lore/src/adapters/http/dashboard-routes.ts, diff:packages/lore/src/adapters/http/routes.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/flows/status-prd-sync-flow.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-enforcer.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/outline-migration-service.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/prd-budget-check.ts, diff:packages/lore/src/service/prd-outline-service.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/http/phase-status.bun.test.ts, diff:packages/lore/tests/integration/bootstrap-outline-payload.bun.test.ts, diff:packages/lore/tests/integration/cli-domain-overview-kind.bun.test.ts, diff:packages/lore/tests/integration/cli-outline.bun.test.ts, diff:packages/lore/tests/integration/cli/gate-bypass-audit.test.ts, diff:packages/lore/tests/integration/prd-budget-check.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/dashboard-routes.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/assets/pre-push-parity.test.ts, diff:packages/lore/tests/unit/cli/status-exempt-surfacing.test.ts, diff:packages/lore/tests/unit/core/outline-schemas.test.ts, diff:packages/lore/tests/unit/service/gate-skip-audit.test.ts, diff:packages/lore/tests/unit/service/outline-migration-dryrun.bun.test.ts, diff:packages/lore/tests/unit/service/outline-writer-guard.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-plan-phase-status-declared.test.ts, diff:packages/lore/tests/unit/service/plan-close-prd-sync.test.ts, diff:packages/lore/tests/unit/service/prd-budget-content-flight.test.ts, diff:packages/lore/tests/unit/service/session-service.test.ts, diff:packages/lore/tests/unit/store/audit-tamper.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.8 | evidence | All 10 ACs carry attested passes; live PRD 103839→16808 chars, budget exit 0, bootstrap 9208 chars, full suites 1257 pass, 41 playwright pass. AC-080-3 fixed after an attested fail. |
| evidence_integrity | 74 | 0.75 | evidence | Attested verify caught a missing oracle file that self-reported evidence hid — good control, bad signal about the other 12 unattested tasks. Ratio 0.39; live-corpus results self-reported only. |
| scope_fidelity | 52 | 0.7 | evidence | Diff includes four features no task declares (parent combobox, review-queue merge, declared-phase panel, bootstrap injection) with SPEC-080 section refs that don't match this spec. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | Unexplained drift: NewDocModal combobox + parent-suggestions.ts, PendingPanel/TriageQueue review-queue merge + review-queue.ts, PhaseProgressPanel declared-phase union + extractDeclaredPhases, and session.ts buildBootstrapInjection/config.ts bootstrap_injection budgets are all in the diff but map to no T1-T9 task, anchor, or Decisions Log entry. They cite dogfood ISSUE-004/008 and a phase-status ADR, i.e. other work streams. |
| scope_fidelity | major | — | session.ts and config.ts document buildBootstrapInjection/resolveBootstrapInjectionBudgets as 'SPEC-080 §Projection Contract, §Public Interface, §Design Decisions D1-D8'. The SPEC-080 in this bundle is the PRD-as-outline contract (C1-C4, AC-080-1..10) with no such sections. The citation cannot be reconciled from the materials provided. |
| evidence_integrity | major | AC-080-3 | T1 self-reported AC-080-3's CLI half as manually verified on a throwaway corpus, but the AC-bound persistent oracle file (tests/integration/cli-domain-overview-kind.bun.test.ts) did not exist — two attested FAIL records confirm it. Remediated within the session, but it demonstrates self-reported task evidence passing while the AC's actual oracle was absent. |
| evidence_integrity | minor | AC-080-1 | The live-corpus half of AC-080-1 (raw body <= 24000, --check-prd-budget exit 0) and T7a/T7b's migration invariants (I3 id/slug preservation, 9 approved children, ADR informs-links) rest entirely on self-reported main-orchestrator e2e/manual records; no attested oracle re-runs the live-corpus assertions. |
| evidence_integrity | minor | — | T8 (authoring-surface sync) has a single oracle=manual grep/manifest line and records typecheck exit 2 in its worktree, attributed to a sibling agent's WIP via git-stash A/B. No post-merge re-verification of T8's own AC is recorded. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Either move the dashboard (ISSUE-004/008, phase-status ADR) and bootstrap-injection changes into their own plans, or add tasks + Decisions Log entries covering them here. As-is the diff cannot be attributed to this plan's declared scope. | Four unrelated feature areas in one plan's diff make scope drift and regression attribution unassessable. |
| spec | Reconcile the SPEC-080 section references in packages/core/src/session.ts and config.ts (§Projection Contract, §Public Interface, D1-D8) with the spec's actual C1-C4 structure; fix whichever side is wrong. | Source citations that name non-existent spec sections break traceability and future audits. |
| process | Make task close assert that each AC's declared script oracle FILE exists and its command exits 0, before accepting self-reported completion. | AC-080-3 passed task-level self-report with no oracle file; only attested verify caught it. |
| process | Add an attested oracle for live-corpus assertions (root PRD raw size, id/slug invariance, --check-prd-budget exit code) rather than accepting main-orchestrator transcript records. | The H-risk live migration (R1) is the least independently verified part of the plan. |

## Unverifiable Materials

- Live corpus state (root PRD 01KVZ4C445EK479938W1TYT3AJ body size, id/slug preservation, 9 approved domain-overview children, 2 extracted ADRs): Only self-reported orchestrator evidence lines; no corpus snapshot or attested oracle in the materials.
- Truncated output tails for full suites (1257 pass), playwright (41 pass), and the composite AC-080-9 command: Summary lines only; failure sections, if any, would not be visible in the shown prefix.
- SPEC-080 spec body (sections C1-C4, Migration Plan, any §Projection Contract): Not provided; the session.ts/config.ts citations to SPEC-080 D1-D8 could not be checked against the real spec text.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 16 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.39
