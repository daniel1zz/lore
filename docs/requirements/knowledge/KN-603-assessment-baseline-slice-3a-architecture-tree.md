---
id: KN-603
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
# Assessment: partially_met (68/100)

Scope: plan `01M4J2Z422456R00AKR91BJ3FJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLS3-1 | 90 | RED test failed before the change (expected-fail on section kind). Afterwards the spec command passes repeatedly (56 tests), plus the race test (8 pass) and the architecture CLI test (18 pass). Store and schema code is not shown in the diff, but the evidence is strong. | task-implement-a-architecture-tree-type-as-ad-registry-cite, task-red-a-architecture-tree-and-as-ad-citation, task-cli-mcp-baseline-add-tree-architecture-and-rule-add-four |
| AC-BLS3-2 | 88 | RED showed VALIDATION_ERROR where AC_CITE_REQUIRED was expected. The exact spec command now passes (36 tests). The ac-cite-gate source is not shown, so the AD refusal path cannot be inspected directly. | task-red-a-architecture-tree-and-as-ad-citation, task-implement-a-architecture-tree-type-as-ad-registry-cite |
| AC-BLS3-3 | 90 | RED failed, then 35 tests pass. The diff shows one ordering SSOT in navigation-roots.ts, used by both bootstrap and tree. Strategy is left absent when there is no baseline, so the no-baseline output stays the same. Good fixture with disagreeing orders. | task-implement-b-baseline-root-navigation, task-red-b-baseline-root-navigation |
| AC-BLS3-4 | 88 | RED failed, then 43 tests pass. The diff shows migrated coverage computed from live script citations across the corpus, migrated and unmigrated listed separately, and unmigrated requirements still counted by refs. Liveness was checked by neutering the check and confirming the test fails. | task-implement-c-requirement-coverage-from-citations, task-red-c-requirement-coverage-from-citations |
| AC-BLS3-5 | 82 | RED failed because setRuleStateService was missing. Afterwards 11 tests pass. app.ts wires the predicate to the real git port. The gate-predicates and corpus-service code for plan close is not shown. | task-implement-d-plan-close-rule-state-predicate-outline-writes, task-red-d-plan-close-rule-state-and-outline-retirement |
| AC-BLS3-6 | 85 | RED failed, then 12 integration tests pass, covering set/rm refused with exit 4 and nothing written. The outline.ts and prd-outline-service source is not shown. Removal of the dead renderer is only implied by test names. | task-implement-d-plan-close-rule-state-predicate-outline-writes, task-red-d-plan-close-rule-state-and-outline-retirement |
| AC-BLS3-7 | 87 | RED failed (skill not installed), then 18 tests pass. The diff shows the seed only writes when the mode is absent (raw yaml document edit), the skill is added to the ledger as kind skill, and three manifest entries are added. | task-implement-e-setup-adoption-baseline-skill-templates, task-red-e-setup-adoption-and-baseline-adopt |
| AC-BLS3-8 | 85 | RED failed, then the spec command passes, plus the gaps test (22 pass). The diff shows the adopt command writes config and one audit row with old/new settings, and status has an audited/unaudited/default decision. Minor: the config is written before the audit row, so a failure in between is not ato… | task-implement-e-setup-adoption-baseline-skill-templates, task-red-e-setup-adoption-and-baseline-adopt |
| AC-BLS3-9 | 68 | A scratchpad Python script reports 1 root, 5 sections, 9 module cards, 18 four-part AS rules and 13 AD entries. The script is in /tmp and its logic is not shown. It is not the rubric's judge. The requirement that each AD names an open issue (#112, #117, #118) is not shown to be checked. | task-wave-4-architecture-tree-content-r-migration-outline-to |
| AC-BLS3-10 | 70 | The scratchpad script reports 28 of 28 requirements migrated and 28 target rules live, and says a knowledge doc holds the outline table. That doc is not linked (knowledge capture is 0). Whether all 12 outline entries are mapped is not shown in the output. | task-wave-4-architecture-tree-content-r-migration-outline-to |
| AC-BLS3-11 | 15 | No evidence. The PRD budget check test was never run under this plan. It is only partly mitigated: the behaviour is kept from SPEC-080 and probably still exists, but outline retirement could have affected it and nothing confirms it didn't. | — |
| AC-BLS3-12 | 15 | No evidence. The detail-link check (-t detail-link) was never run under this plan. It is an inherited behaviour, so the risk is moderate, but it is unverified. | — |
| AC-BLS3-13 | 25 | No evidence was recorded, even though outline-writer-guard.test.ts was touched in this diff. The outline-retired tests from AC-BLS3-6 partly cover the CLI side, but the direct `lore set extra.outline` refusal is unattested. | task-implement-d-plan-close-rule-state-predicate-outline-writes (related AC-BLS3-6 evidence only) |

## Gaps

- No evidence run for the PRD budget check (prd-budget-check.bun.test.ts) after outline retirement.
- Detail-link check (-t detail-link) not run or attested.
- packages/lore/tests/unit/service/outline-writer-guard.test.ts was touched but its spec command was never attested.
- AI-rubric ACs 9 and 10 were verified only by an ephemeral /tmp scratchpad script whose logic is not preserved, and the AD-to-open-issue mapping is not shown.
- packages/lore/src/adapters/cli/commands/status.ts emits ac_cite unconditionally in --json, which may break the no-baseline byte-identity invariant.
- packages/lore/src/adapters/cli/commands/status.ts duplicates requirement_coverage under data.requirements to satisfy a test contract.

## Recommendations

- Make plan close require at least one attested pass for every in-scope AC, including ACs re-homed from deprecated specs.
- For AI-rubric corpus ACs, record the rubric judge's output or commit the check script, rather than relying on /tmp scratchpad scripts.
- State whether new status --json keys count against the no-baseline byte-identity invariant.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 45663ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/cli/baseline-adopt.bun.test.ts, diff:packages/lore/tests/integration/cli/baseline-root-navigation.bun.test.ts, diff:packages/lore/tests/integration/cli/setup-baseline-adoption.bun.test.ts, diff:packages/core/tests/unit/requirement.test.ts, diff:packages/lore/tests/unit/service/requirement-coverage-from-cites.test.ts, diff:packages/lore/tests/unit/service/requirement-migration-rule-liveness.test.ts, diff:packages/lore/tests/unit/service/requirement-service.test.ts, diff:assets/skills/lore-baseline/SKILL.md, diff:assets/skills/lore-baseline/templates/branch.md, diff:assets/skills/lore-baseline/templates/leaf.md, diff:packages/lore/tests/integration/cli/baseline-adopt-gaps.bun.test.ts, diff:packages/lore/tests/integration/cli/setup-baseline-adoption.bun.test.ts, diff:packages/lore/tests/integration/setup-adoption-config-write.bun.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/src/adapters/cli/commands/outline.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-enforcer.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/outline-migration-service.ts, diff:packages/lore/src/service/prd-outline-service.ts, diff:packages/lore/src/service/prd-sync-domain-doc.ts, diff:packages/lore/src/service/predicate-contracts.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/tests/e2e/plan-close-invariants-compiled.bun.test.ts, diff:packages/lore/tests/e2e/plan-close-known-false-pass.bun.test.ts, diff:packages/lore/tests/integration/bootstrap-outline-payload.bun.test.ts, diff:packages/lore/tests/integration/cli-outline.bun.test.ts, diff:packages/lore/tests/integration/cli/outline-retired.bun.test.ts, diff:packages/lore/tests/unit/cli/approve-advisory-render.test.ts, diff:packages/lore/tests/unit/cli/plan-exempt-attestation.test.ts, diff:packages/lore/tests/unit/service/outline-writer-guard.test.ts, diff:packages/lore/tests/unit/service/plan-close-prd-sync.test.ts, diff:packages/lore/tests/unit/service/plan-close-predicate-provenance.test.ts, diff:packages/lore/tests/unit/service/plan-close-rule-state.test.ts, diff:packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts, diff:packages/lore/tests/unit/service/plan-promote-prd-sync-advisory.test.ts, diff:packages/lore/tests/unit/service/predicate-applicability.test.ts, diff:packages/lore/tests/unit/service/predicate-contracts.test.ts, diff:assets/skills/lore-product-lens/SKILL.md, diff:assets/skills/lore-product/SKILL.md, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/core/src/acceptance.ts, diff:packages/core/src/baseline.ts, diff:packages/core/src/errors.ts, diff:packages/core/src/schemas.ts, diff:packages/lore/src/service/ac-cite-gate.ts, diff:packages/lore/src/service/ac-write-chokepoint.ts, diff:packages/lore/src/service/baseline-status.ts, diff:packages/lore/src/service/resume-rule-diff.ts, diff:packages/lore/src/service/rule-index-queries.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/migrations/migration-014.ts, diff:packages/lore/src/store/migrations/migration-015.ts, diff:packages/lore/src/store/schema-version.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-interface.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/adapters/sync-push.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/architecture-standard-rule.test.ts, diff:packages/lore/tests/unit/service/baseline-architecture-tree.test.ts, diff:packages/lore/tests/unit/service/cite-gate-architecture.test.ts, diff:packages/lore/tests/unit/store/audit-chain.bun.test.ts, diff:packages/lore/tests/unit/store/migration-001-idempotent.bun.test.ts, diff:packages/lore/tests/unit/store/migration-003.bun.test.ts, diff:packages/lore/tests/unit/store/migration-004.bun.test.ts, diff:packages/lore/tests/unit/store/migration-006-fk-restore.bun.test.ts, diff:packages/lore/tests/unit/store/migration-008-cjk-fts.bun.test.ts, diff:packages/lore/tests/unit/store/migration-012.bun.test.ts, diff:packages/lore/tests/unit/store/migration-013.bun.test.ts, diff:packages/lore/tests/unit/store/migration-014.bun.test.ts, diff:packages/lore/tests/unit/store/rule-registry-prefix-race.bun.test.ts, diff:packages/lore/tests/unit/store/trace-events.bun.test.ts, diff:packages/lore/tests/unit/store/version-slug-migration.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/baseline.ts, diff:packages/lore/src/adapters/cli/commands/rule.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/service/rule-service.ts, diff:packages/lore/tests/integration/cli/architecture-cli.bun.test.ts, diff:packages/lore/src/service/navigation-roots.ts, diff:packages/lore/tests/integration/cli/baseline-root-navigation.bun.test.ts, diff:packages/lore/tests/unit/service/navigation-roots.test.ts
- Reasoning clipped for: AC-BLS3-8

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 75 | 0.7 | evidence | Script ACs 1-8 are well evidenced with RED-first tests. The corpus ACs rely on a weak script. Three re-homed ACs are unverified. |
| evidence_integrity | 62 | 0.7 | evidence | Good RED-to-GREEN trail for groups A-E. Three ACs have no runs at all. Wave 4 relies on an ephemeral scratchpad script. Attested ratio is 0.72. |
| scope_fidelity | 78 | 0.6 | evidence | Changes map to waves A-E. Minor drift: a duplicate status JSON key, ac_cite always emitted, and the approve advisory removed (plausibly part of D). |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLS3-11 | No evidence run for the PRD budget check (prd-budget-check.bun.test.ts) after outline retirement. |
| evidence_integrity | major | AC-BLS3-12 | Detail-link check (-t detail-link) not run or attested. |
| evidence_integrity | major | AC-BLS3-13 | packages/lore/tests/unit/service/outline-writer-guard.test.ts was touched but its spec command was never attested. |
| evidence_integrity | minor | AC-BLS3-9 | AI-rubric ACs 9 and 10 were verified only by an ephemeral /tmp scratchpad script whose logic is not preserved, and the AD-to-open-issue mapping is not shown. |
| outcome | minor | — | packages/lore/src/adapters/cli/commands/status.ts emits ac_cite unconditionally in --json, which may break the no-baseline byte-identity invariant. |
| scope_fidelity | minor | — | packages/lore/src/adapters/cli/commands/status.ts duplicates requirement_coverage under data.requirements to satisfy a test contract. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make plan close require at least one attested pass for every in-scope AC, including ACs re-homed from deprecated specs. | Three ACs closed with zero runs. |
| process | For AI-rubric corpus ACs, record the rubric judge's output or commit the check script, rather than relying on /tmp scratchpad scripts. | Ephemeral evidence cannot be audited. |
| spec | State whether new status --json keys count against the no-baseline byte-identity invariant. | The ac_cite key is ambiguous under AC-BLS2-11. |

## Unverifiable Materials

- check9_10.py scratchpad script: Not in the diff, so its counting logic and AD-to-issue checks cannot be inspected.
- gate-predicates.ts, outline.ts, ac-cite-gate.ts, migration-015.ts: Truncated from the diff, so implementation quality is judged from tests only.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 12 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.72
