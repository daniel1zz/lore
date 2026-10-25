---
id: KN-602
type: knowledge
role: knowledge
title: "Assessment: Baseline slice 3a: architecture tree, baseline-root navigation, requirements to rules, outline retirement, distribution (2026-10-10)"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
parent: PLAN-167
links:
  - {id: PLAN-167, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01M4J2Z422456R00AKR91BJ3FJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS3-1 | 90 | Logged RED run, then 56/56 baseline-architecture-tree passes and 23 standard-rule passes. A separate 8-test bun suite covers the prefix-race registry. CLI wiring is covered by architecture-cli (18 pass, after RED). Schema/migration source is truncated, so quality is unseen. | task-implement-a-architecture-tree-type-as-ad-registry-cite, task-red-a-architecture-tree-and-as-ad-citation, task-cli-mcp-baseline-add-tree-architecture-and-rule-add-four |
| AC-BLS3-2 | 88 | The RED run showed AD refused as VALIDATION_ERROR instead of AC_CITE_REQUIRED. After the fix, 36/36 cite-gate-architecture tests pass. ac-cite-gate.ts is truncated, so the refusal path cannot be inspected. | task-red-a-architecture-tree-and-as-ad-citation, task-implement-a-architecture-tree-type-as-ad-registry-cite |
| AC-BLS3-3 | 90 | The diff shows one shared ordering module (navigation-roots.ts). Bootstrap adds a Strategy line only when a baseline root exists, and the tree defaults to the baseline root. RED run then 35/35 passes, including a fixture where the two orderings disagree. | task-implement-b-baseline-root-navigation, task-red-b-baseline-root-navigation |
| AC-BLS3-4 | 87 | The diff shows computeRequirementCoverage splitting migrated from unmigrated requirements, plus corpus-wide collection of live script citations and a live-rule check in migrate. RED run then 43 passes. Status JSON now writes the same payload under two keys, which is a small wart. | task-implement-c-requirement-coverage-from-citations, task-red-c-requirement-coverage-from-citations |
| AC-BLS3-5 | 85 | RED failed on the missing setRuleStateService, then 11/11 pass. app.ts wires a lazy RuleStateService on the git port. gate-predicates.ts is truncated, so I could not confirm the stale-rule and attested-pass logic from source. | task-implement-d-plan-close-rule-state-predicate-outline-writes, task-red-d-plan-close-rule-state-and-outline-retirement |
| AC-BLS3-6 | 84 | RED run, then 12/12 outline-retired passes: set/rm exit 4, write nothing, list kept. Removal of the dead bootstrap outline renderer is not visible in the shown diff (outline.ts and prd-outline-service.ts are truncated). | task-implement-d-plan-close-rule-state-predicate-outline-writes, task-red-d-plan-close-rule-state-and-outline-retirement |
| AC-BLS3-7 | 88 | The diff shows the seed-only-when-absent adapter using the yaml Document API, skill files installed as ledger candidates, and manifest entries added for the 3 skill files. RED run then 18/18 passes. | task-implement-e-setup-adoption-baseline-skill-templates, task-red-e-setup-adoption-and-baseline-adopt |
| AC-BLS3-8 | 87 | The adopt command writes the config first, then one audit row holding old and new settings. Refusals exit 2 and write nothing, and status provenance is audited, unaudited or default. RED run then 22 passes across both files. | task-implement-e-setup-adoption-baseline-skill-templates, task-red-e-setup-adoption-and-baseline-adopt |
| AC-BLS3-9 | 65 | The only evidence is a throwaway /private/tmp scratchpad script, not a rubric judgment. Counts: 1 root, 5 sections, 9 module cards, 18 four-part AS rules, 13 AD entries. Nothing shows the ADs name #112, #117 and #118 as the rubric requires. | task-wave-4-architecture-tree-content-r-migration-outline-to |
| AC-BLS3-10 | 68 | The same scratchpad script reports 28/28 requirements migrated to live rules and names the knowledge doc holding the table. Its output does not confirm all 12 outline entries are mapped to branches, and the script cannot be re-run. | task-wave-4-architecture-tree-content-r-migration-outline-to |
| AC-BLS3-11 | 82 | One attested pass with the exit-3 and exit-0 cases shown. The <1000 ms timing and the live root PRD's <=24000-char check are not visible in the clipped tail. This is kept behaviour, so no RED run was expected. | task-implement-d-plan-close-rule-state-predicate-outline-writes |
| AC-BLS3-12 | 85 | One attested pass of the detail-link cases (zero links, soft-deleted target) through --check-prd-budget. | task-implement-d-plan-close-rule-state-predicate-outline-writes |
| AC-BLS3-13 | 80 | One attested run, 12/12 outline-writer-guard passes. No RED run is logged, and the guard source (corpus-service/prd-outline-service) is truncated. | task-implement-d-plan-close-rule-state-predicate-outline-writes |

## Gaps

- The AC-BLS3-9/10 evidence is a scratchpad python script outside the repo. It does not show AD entries naming #112, #117 and #118, or the 12 outline-to-branch rows.
- status.ts always adds ac_cite to the lore status --json data, even for no-baseline corpora. That may break the invariant that no-baseline output stays byte-identical (AC-BLS2-11).
- status.ts duplicates requirement_coverage under a new 'requirements' key purely to match a test contract, creating two public keys for one payload.
- Wave 4's exit criteria (census mapping of new sites, all-12 branches at 0 coverage gaps, baseline review) have no recorded evidence.

## Recommendations

- Require that ai-rubric ACs be evidenced by an in-repo or rubric-judge run whose output lists each rubric clause, not a /tmp script.
- Add an AC or check that pins lore status --json byte-identity on no-baseline corpora after ac_cite is added.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 44040ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/cli/baseline-adopt.bun.test.ts, diff:packages/lore/tests/integration/cli/baseline-root-navigation.bun.test.ts, diff:packages/lore/tests/integration/cli/setup-baseline-adoption.bun.test.ts, diff:packages/core/tests/unit/requirement.test.ts, diff:packages/lore/tests/unit/service/requirement-coverage-from-cites.test.ts, diff:packages/lore/tests/unit/service/requirement-migration-rule-liveness.test.ts, diff:packages/lore/tests/unit/service/requirement-service.test.ts, diff:assets/skills/lore-baseline/SKILL.md, diff:assets/skills/lore-baseline/templates/branch.md, diff:assets/skills/lore-baseline/templates/leaf.md, diff:packages/lore/tests/integration/cli/baseline-adopt-gaps.bun.test.ts, diff:packages/lore/tests/integration/cli/setup-baseline-adoption.bun.test.ts, diff:packages/lore/tests/integration/setup-adoption-config-write.bun.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/src/adapters/cli/commands/outline.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-enforcer.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/outline-migration-service.ts, diff:packages/lore/src/service/prd-outline-service.ts, diff:packages/lore/src/service/prd-sync-domain-doc.ts, diff:packages/lore/src/service/predicate-contracts.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts, diff:packages/lore/tests/e2e/plan-close-known-false-pass.bun.test.ts, diff:packages/lore/tests/integration/bootstrap-outline-payload.bun.test.ts, diff:packages/lore/tests/integration/cli-outline.bun.test.ts, diff:packages/lore/tests/integration/cli/outline-retired.bun.test.ts, diff:packages/lore/tests/unit/cli/approve-advisory-render.test.ts, diff:packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts, diff:packages/lore/tests/unit/service/outline-writer-guard.test.ts, diff:packages/lore/tests/unit/service/plan-close-prd-sync.test.ts, diff:packages/lore/tests/unit/service/plan-close-predicate-provenance.test.ts, diff:packages/lore/tests/unit/service/plan-close-rule-state.test.ts, diff:packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts, diff:packages/lore/tests/unit/service/plan-promote-prd-sync-advisory.test.ts, diff:packages/lore/tests/unit/service/predicate-applicability.test.ts, diff:packages/lore/tests/unit/service/predicate-contracts.test.ts, diff:assets/skills/lore-product-lens/SKILL.md, diff:assets/skills/lore-product/SKILL.md, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/core/src/acceptance.ts, diff:packages/core/src/baseline.ts, diff:packages/core/src/errors.ts, diff:packages/core/src/schemas.ts, diff:packages/lore/src/service/ac-cite-gate.ts, diff:packages/lore/src/service/ac-write-chokepoint.ts, diff:packages/lore/src/service/baseline-status.ts, diff:packages/lore/src/service/resume-rule-diff.ts, diff:packages/lore/src/service/rule-index-queries.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/migrations/migration-014.ts, diff:packages/lore/src/store/migrations/migration-015.ts, diff:packages/lore/src/store/schema-version.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/architecture-standard-rule.test.ts, diff:packages/lore/tests/unit/service/baseline-architecture-tree.test.ts, diff:packages/lore/tests/unit/service/cite-gate-architecture.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/migration-012.bun.test.ts, diff:packages/lore/tests/unit/store/migration-013.bun.test.ts, diff:packages/lore/tests/unit/store/migration-014.bun.test.ts, diff:packages/lore/tests/unit/store/rule-registry-prefix-race.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/adapters/cli/commands/rule.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/tests/integration/cli/architecture-cli.bun.test.ts, diff:packages/lore/src/service/navigation-roots.ts, diff:packages/lore/tests/integration/cli/baseline-root-navigation.bun.test.ts, diff:packages/lore/tests/unit/service/navigation-roots.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 83 | 0.7 | evidence | Script ACs show RED-then-GREEN with diff support. The corpus ACs 9/10 are only partly evidenced, and the Wave 4 exit criteria are unproven. |
| evidence_integrity | 76 | 0.65 | evidence | Separate testers logged RED runs. But AC-9/10 evidence comes from an ephemeral /tmp script, some runs were in worktrees, and the 0.74 attested ratio leaves gaps. |
| scope_fidelity | 80 | 0.6 | evidence | Changes map to waves A-E. Minor drift: the duplicate status JSON key, the always-on ac_cite status field, and unseen edits to the lore-product skills. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS3-9 | The AC-BLS3-9/10 evidence is a scratchpad python script outside the repo. It does not show AD entries naming #112, #117 and #118, or the 12 outline-to-branch rows. |
| outcome | major | — | status.ts always adds ac_cite to the lore status --json data, even for no-baseline corpora. That may break the invariant that no-baseline output stays byte-identical (AC-BLS2-11). |
| scope_fidelity | minor | AC-BLS3-4 | status.ts duplicates requirement_coverage under a new 'requirements' key purely to match a test contract, creating two public keys for one payload. |
| outcome | minor | — | Wave 4's exit criteria (census mapping of new sites, all-12 branches at 0 coverage gaps, baseline review) have no recorded evidence. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that ai-rubric ACs be evidenced by an in-repo or rubric-judge run whose output lists each rubric clause, not a /tmp script. | Ephemeral scripts cannot be re-run or audited. |
| spec | Add an AC or check that pins lore status --json byte-identity on no-baseline corpora after ac_cite is added. | Protects the plan's own invariant. |

## Unverifiable Materials

- scratchpad/s3/check9_10.py: Script content not provided and not in repo; cannot confirm what it checks.
- packages/lore/src/service/gate-predicates.ts, outline.ts, ac-cite-gate.ts: Truncated; predicate and guard logic seen only via tests.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 12 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.74
