---
id: KN-165
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-080 PRD-as-outline contract (2026-07-26)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-10-23
tags: []
parent: PLAN-031
links:
  - {id: PLAN-031, type: informs}
  - {id: KN-164, type: supersedes}
---
# Assessment: met (83/100)

Scope: plan `01KYEH9MDRVN9WEZ61M43FK5EJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-080-1 | 92 | 5 pass / 0 fail (2 attested). T7b live-corpus evidence: PRD raw body 16808 <= 24000 and --check-prd-budget exit 0 on the live corpus; fixture over/under-budget + latency cases pinned in prd-budget-check.bun.test.ts. | 01KYEHQB7FRNQWA3EG9K9H738A (T7b live raw-body 16808 chars, budget exit 0), 01KYEHAWZ73JG2B2VQQJKZXG8M (T9 attested reruns [6][16]) |
| AC-080-2 | 90 | 5 pass / 0 fail (2 attested). outline-writer-guard.test.ts 15/15 green twice under attestation; T2r RED→GREEN pair documented; CorpusService.set guard regression-pinned via corpus-service (77) + drop-guard (7). | 01KYEHAR9X6KY9JFA6J0J87R58 (T2 implementation + regression pins), 01KYEHAWZ73JG2B2VQQJKZXG8M (T9 attested [1][11]) |
| AC-080-3 | 76 | Only AC with attested FAILS (2): the bound oracle file did not exist at first verify while T1 had self-reported a manual pass. Remediated in-plan — file authored, 3/3 attested pass (HAPPY/NEGATIVE/BOUNDARY). Met, but the original evidence was unbacked. | 01KYEHAWZ73JG2B2VQQJKZXG8M ([2][12] fail → [21][22] pass; [26] verify-runner remediation note), 01KYEHAPS0KNZW6PTR52QS1N0P (T1 self-reported manual throwaway-corpus check) |
| AC-080-4 | 88 | 3 pass / 0 fail (2 attested). plan-close-prd-sync.test.ts 11/11; T5r RED confirmed 8 missing-impl failures before T5. Window/exemption/knob-OFF scenarios declared; predicate source file not visible in diff (truncated), so shape judged from evidence only. | 01KYEHAV04PSHJH3NT8PR5HC0V (T5 predicate + status splice), 01KYEHATKA913G5N5S62M5YCR5 (T5r RED baseline) |
| AC-080-5 | 88 | 3 pass / 0 fail (2 attested). status-exempt-surfacing.test.ts 6/6 covering CorpusService.status().exempt_plans + renderExemptPlansSection; zero-exemption byte-stability claimed in T5 evidence and pinned by the regression cases. | 01KYEHAV04PSHJH3NT8PR5HC0V (T5 [3] 6/6 render + regression), 01KYEHAWZ73JG2B2VQQJKZXG8M (T9 attested [3][13]) |
| AC-080-6 | 90 | 3 pass / 0 fail (2 attested). prd-budget-content-flight.test.ts 17/17 twice; T4 evidence records a matched-count check (grep -c 'it(' = 17) against the fixture, covering threshold boundary, typed-schema exclusions, and custom-budget anti-hardcoding. | 01KYEHAT6TBJ0DY9TXZMM93XRY (T4 [1][3] matched-count verified) |
| AC-080-7 | 90 | 3 pass / 0 fail (2 attested). outline-migration-dryrun.bun.test.ts shows per-section char-coverage/section-ref/R-id verdicts with zero writes, plus a violation fixture naming the failed invariants; T6r RED was missing-module only. | 01KYEHAVSBVS6MCT1ZMJGGBR9W (T6 12/12 across dry-run + payload files), 01KYEHAQGKJ8CZKAKJRX5NP4M0 (T6r RED confirmation) |
| AC-080-8 | 92 | 4 pass / 0 fail (2 attested) on the fixture, plus the stronger LIVE pin: lore bootstrap --json = 9208 chars < 32000 on the migrated corpus (T9 [25]). Fixture NEGATIVE case also pins <10% of pre-migration full-prose size. | 01KYEHAWZ73JG2B2VQQJKZXG8M ([5][15] fixture, [25] live-corpus 9208 chars) |
| AC-080-9 | 90 | 4 pass / 0 fail (2 attested). Composite e2e (playwright + bootstrap --json + --check-requirements) exit 0 twice attested; T9 [24] records a clean unpiped rerun 41 passed, and [23] full typecheck + 1257/0 both runners. | 01KYEHAWZ73JG2B2VQQJKZXG8M ([9][19][23][24]) |
| AC-080-10 | 88 | 3 pass / 0 fail (2 attested) via -t detail-link: zero-rel=detail entry → exit 3, soft-deleted target → exit 3, compliant → exit 0. T4 records matched-count 3 = the 3 declared it() blocks (no vacuous filter). 1-hop check also observed live in T7a. | 01KYEHAT6TBJ0DY9TXZMM93XRY (T4 [4] matched-count 3), 01KYEHAW5ZRGJY5TMQAA3CSVTR (T7a: detail links resolve 1-hop to approved children) |

## Gaps

- The AC-bound oracle file cli-domain-overview-kind.bun.test.ts did not exist through two attested verify rounds (exit 1, filter matched no files) while T1 had already recorded a manual pass for the same AC half. It was authored and passed only after the close-out verify runner flagged it — evidence for this AC was self-reported and unbacked until the final gate.
- Substantial production changes in the diff map to no plan task or spec AC: NewDocModal parent combobox + parent-suggestions lib (ISSUE-004), PendingPanel/TriageQueue review-queue merge + StatusPill (ISSUE-008), PhaseProgressPanel/api.ts declared-phase discriminated union, schemas.ts extractDeclaredPhases, and session.ts buildBootstrapInjection + config.ts bootstrap_injection budgets. No Decisions Log entry or task explains their inclusion.
- session.ts and config.ts cite 'SPEC-080 §Projection Contract', '§Public Interface', 'D1-D8' — sections that do not exist in the SPEC-080 this plan implements (PRD-as-outline; C1-C4; AC-080-1..10). Either a spec-number collision or stale provenance; unresolvable from the materials.
- Attested evidence ratio 0.39, with 22 of 22 attested records concentrated in T9. Every implementation task (T1-T6, T8) recorded 0 attested runs; several also recorded non-zero typecheck exits attributed to concurrent sibling worktrees, verifiable only via the tasks' own narration.
- Invariant I5 (all pre-existing suites byte-unchanged when the flag/knob is disarmed) is asserted in T4/T5 prose and inferred from full-suite green, but no named oracle pins plain `lore status` output byte-identity against a pre-change baseline.
- T7a's evidence tail ends mid-sentence at 'DEVIATION RECORDED: spec-promote base >=1' — a recorded deviation on a live-corpus mutation task whose content and acceptance cannot be read from the bundle.

## Recommendations

- Make an implementation task's AC-bound oracle file existence a precondition of recording a pass: run the exact AC command and reject a pass whose runner reports 'no test files matched'.
- Require at least one attested oracle run per implementation task rather than concentrating attestation in the close-out task.
- Bound the assess diff to the plan's own commits, or require the close-out task to enumerate concurrent unrelated commits included in the range.
- Reconcile the 'SPEC-080 §Projection Contract / D1-D8' citations in session.ts and config.ts against the approved SPEC-080, or renumber the cited spec.
- Add an explicit I5 oracle: capture plain `lore status` output pre-change and assert byte-identity post-change.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 101190ms
- Retried: false
- Truncated sections: diff:.lore/audit-anchor.json, diff:CLAUDE.md, diff:assets/hooks/session-start-resume.mjs, diff:assets/project/pre-push, diff:assets/skills/lore-product/SKILL.md, diff:hooks/pre-push, diff:packages/core/tests/unit/bootstrap-injection.test.ts, diff:packages/dashboard/CLAUDE.md, diff:packages/dashboard/src/lib/parent-suggestions.ts, diff:packages/dashboard/src/lib/review-queue.ts, diff:packages/dashboard/tests/component/NewDocModal.test.tsx, diff:packages/dashboard/tests/component/PendingPanel.test.tsx, diff:packages/dashboard/tests/component/PhaseProgressPanel.test.tsx, diff:packages/dashboard/tests/component/TriageQueue.test.tsx, diff:packages/dashboard/tests/unit/lib/parent-suggestions.test.ts, diff:packages/dashboard/tests/unit/lib/review-queue.test.ts, diff:packages/lore/src/adapters/cli/CLAUDE.md, diff:packages/lore/src/adapters/cli/commands/bootstrap.ts, diff:packages/lore/src/adapters/cli/commands/gate.ts, diff:packages/lore/src/adapters/cli/commands/migrate.ts, diff:packages/lore/src/adapters/cli/commands/outline.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/adapters/cli/gate-bypass-audit.ts, diff:packages/lore/src/adapters/cli/index.ts, diff:packages/lore/src/adapters/http/auth.ts, diff:packages/lore/src/adapters/http/dashboard-routes.ts, diff:packages/lore/src/adapters/http/routes.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/flows/status-prd-sync-flow.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-enforcer.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/outline-migration-service.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/prd-budget-check.ts, diff:packages/lore/src/service/prd-outline-service.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/http/phase-status.bun.test.ts, diff:packages/lore/tests/integration/bootstrap-outline-payload.bun.test.ts, diff:packages/lore/tests/integration/cli-domain-overview-kind.bun.test.ts, diff:packages/lore/tests/integration/cli-outline.bun.test.ts, diff:packages/lore/tests/integration/cli/gate-bypass-audit.test.ts, diff:packages/lore/tests/integration/prd-budget-check.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/dashboard-routes.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/assets/pre-push-parity.test.ts, diff:packages/lore/tests/unit/cli/status-exempt-surfacing.test.ts, diff:packages/lore/tests/unit/core/outline-schemas.test.ts, diff:packages/lore/tests/unit/service/gate-skip-audit.test.ts, diff:packages/lore/tests/unit/service/outline-migration-dryrun.bun.test.ts, diff:packages/lore/tests/unit/service/outline-writer-guard.test.ts, diff:packages/lore/tests/unit/service/phase-workflow-plan-phase-status-declared.test.ts, diff:packages/lore/tests/unit/service/plan-close-prd-sync.test.ts, diff:packages/lore/tests/unit/service/prd-budget-content-flight.test.ts, diff:packages/lore/tests/unit/service/session-service.test.ts, diff:packages/lore/tests/unit/store/audit-tamper.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.8 | evidence | All 10 ACs attested-pass; live corpus PRD 16808<=24000, budget exit 0, bootstrap 9208<32000, e2e + full suites (1257/0) green. AC-080-3 needed in-plan remediation. |
| evidence_integrity | 78 | 0.75 | evidence | Attested verify caught a missing AC-080-3 oracle behind a self-reported pass — good control, bad input. Ratio 0.39; matched-count checks recorded; 8 impl tasks fully self-reported. |
| scope_fidelity | 60 | 0.6 | evidence | Diff includes dashboard combobox, review-queue merge, declared-phase union and bootstrap-injection projection that no task declares; may be concurrent commits in the diff range, unstated. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-080-3 | The AC-bound oracle file cli-domain-overview-kind.bun.test.ts did not exist through two attested verify rounds (exit 1, filter matched no files) while T1 had already recorded a manual pass for the same AC half. It was authored and passed only after the close-out verify runner flagged it — evidence for this AC was self-reported and unbacked until the final gate. |
| scope_fidelity | major | — | Substantial production changes in the diff map to no plan task or spec AC: NewDocModal parent combobox + parent-suggestions lib (ISSUE-004), PendingPanel/TriageQueue review-queue merge + StatusPill (ISSUE-008), PhaseProgressPanel/api.ts declared-phase discriminated union, schemas.ts extractDeclaredPhases, and session.ts buildBootstrapInjection + config.ts bootstrap_injection budgets. No Decisions Log entry or task explains their inclusion. |
| scope_fidelity | minor | — | session.ts and config.ts cite 'SPEC-080 §Projection Contract', '§Public Interface', 'D1-D8' — sections that do not exist in the SPEC-080 this plan implements (PRD-as-outline; C1-C4; AC-080-1..10). Either a spec-number collision or stale provenance; unresolvable from the materials. |
| evidence_integrity | minor | — | Attested evidence ratio 0.39, with 22 of 22 attested records concentrated in T9. Every implementation task (T1-T6, T8) recorded 0 attested runs; several also recorded non-zero typecheck exits attributed to concurrent sibling worktrees, verifiable only via the tasks' own narration. |
| outcome | minor | — | Invariant I5 (all pre-existing suites byte-unchanged when the flag/knob is disarmed) is asserted in T4/T5 prose and inferred from full-suite green, but no named oracle pins plain `lore status` output byte-identity against a pre-change baseline. |
| evidence_integrity | minor | — | T7a's evidence tail ends mid-sentence at 'DEVIATION RECORDED: spec-promote base >=1' — a recorded deviation on a live-corpus mutation task whose content and acceptance cannot be read from the bundle. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make an implementation task's AC-bound oracle file existence a precondition of recording a pass: run the exact AC command and reject a pass whose runner reports 'no test files matched'. | AC-080-3's oracle was absent through two attested rounds while a manual self-report stood in for it; only the close-out verify caught it. |
| plan | Require at least one attested oracle run per implementation task rather than concentrating attestation in the close-out task. | Attested ratio 0.39 with all 22 attested records in T9; the eight code tasks are entirely self-reported. |
| process | Bound the assess diff to the plan's own commits, or require the close-out task to enumerate concurrent unrelated commits included in the range. | Dashboard, phase-status and bootstrap-injection changes cannot be attributed to this plan or excluded from it. |
| spec | Reconcile the 'SPEC-080 §Projection Contract / D1-D8' citations in session.ts and config.ts against the approved SPEC-080, or renumber the cited spec. | The cited sections are absent from the SPEC-080 this plan implements, breaking source traceability. |
| plan | Add an explicit I5 oracle: capture plain `lore status` output pre-change and assert byte-identity post-change. | I5 is currently an assertion in task prose rather than a pinned check. |

## Unverifiable Materials

- packages/lore/src/service/prd-outline-service.ts, prd-budget-check.ts, outline-migration-service.ts, checkpoint-registry.ts, gate-predicates.ts, corpus-service.ts, commands/outline.ts, commands/status.ts, flows/status-prd-sync-flow.ts: Listed in the truncation manifest as present but unseen; implementation quality of every SPEC-080 mechanism was judged from evidence records only, not source.
- All 27 omitted test files (outline-writer-guard, plan-close-prd-sync, prd-budget-check, outline-migration-dryrun, bootstrap-outline-payload, cli-domain-overview-kind, status-exempt-surfacing): Test bodies unseen; assertion strength beyond the recorded pass counts and the tasks' own matched-count notes could not be checked.
- Live root PRD doc (id 01KVZ4C445EK479938W1TYT3AJ) before/after migration: I3 identity preservation and content set-equality across the 11 migrated sections rest solely on the orchestrator's own transcript summaries.
- T7a's truncated DEVIATION note ('spec-promote base >=1'): Evidence tail is cut mid-sentence; the deviation's nature and whether it was accepted cannot be determined.
- Commit boundaries of the assess diff range: Cannot tell whether the dashboard/phase-status/bootstrap-injection changes are this plan's work or concurrent commits swept in by <first-task-commit>..HEAD.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 16 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.39
