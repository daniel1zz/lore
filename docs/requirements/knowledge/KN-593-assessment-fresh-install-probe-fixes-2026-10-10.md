---
id: KN-593
type: knowledge
role: knowledge
title: "Assessment: Fresh-install probe fixes (2026-10-10)"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-163
links:
  - {id: PLAN-163, type: informs}
---
# Assessment: partially_met (77/100)

Scope: plan `01M4KE1CMK2RQTAXYXZT92BK2B`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-FIP-1 | 40 | There is no evidence for this AC in this plan (0 pass, 0 fail). The plan says F1 landed through the ad-hoc hotfix task and was attested there, but that evidence is not in these materials. The diff contains no tree_position change and no review-tree-position-parentless test, so the claim cannot be c… | task-hotfix-f1-review-tree-position-rejects-every-parentless (claimed elsewhere, not in materials) |
| AC-FIP-2 | 82 | There are 2 attested passes, plus a red-first expected-fail. The scan test is visible: it walks all of assets/**, uses several pairing regexes, includes a self-test of the regressions, and checks kickoff ordering and the lore-source-only marking. The edited SKILL.md files are omitted from the diff.… | task-fip-skills-carry-the-no-parent-contract-everywhere |
| AC-FIP-3 | 82 | There are 2 attested passes after a red-first run. The diff shows setup's seed now writes the same baseline_adopt audit row, status exposes armed_branches and enforce_refuses_nothing, and adopt prints the warning. The test file itself is omitted. If the audit append fails, the config stays seeded a… | task-fip-seeded-ac-cite-mode-is-audited-and-empty-armed-enforce |
| AC-FIP-4 | 90 | The test is visible: 2 BR + 1 AS gives rules_total 3, AD entries are excluded and reported apart, AS verification state is checked, and there is a BR-only regression case. Family is derived from the ruleIdPrefixOfNode SSOT (single source of truth) in both baseline-status and rule-state-service. The… | task-fip-status-rule-totals-count-architecture-rules |
| AC-FIP-5 | 85 | A refused add now hints 'ac add ... --cite', while a refused set of an existing criterion keeps 'ac cite'. The help text is updated. formatTree is rewritten with relative prefixes, and golden renders at depth 1 and 4 pass, attested. One gap: for a refused create spec with inline criteria, the hint … | task-fip-cite-refusal-hint-and-tree-help-and-render |
| AC-FIP-6 | 72 | The final run [7] is an attested pass; [1] is the red-first run. Runs [4]–[6] failed, and the cause of [5]/[6] is hidden by truncated tails. The probe script and its step library are omitted, so the step list (exit 4, Implements, census, migrate preview) cannot be inspected. A visible unit suite co… | task-fip-automated-fresh-install-probe-script |

## Gaps

- AC-FIP-1 has 0 pass and 0 fail in this plan. The attestation lives in an external hotfix task that is not included, and the named test file is not in the diff.
- refusedIsNew is true for inline criteria on a refused spec create, so cite_line suggests 'lore ac add spec-born-uncited ...' for a spec that was never written (see packages/lore/tests/unit/service/cite-gate-create.test.ts).
- The probe source scripts/fresh-install-probe.ts is omitted, and the cause of the post-fix failures in runs [5] and [6] is truncated.

## Recommendations

- Require each spec AC to have in-bundle evidence, or a linked attested record imported into the plan, before archival.
- Specify the refusal hint for criteria passed inline to a spec create, for example re-run create with --cite.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 38133ms
- Retried: false
- Truncated sections: diff:assets/skills/lore-baseline/SKILL.md, diff:assets/skills/lore-design/SKILL.md, diff:assets/skills/lore-kickoff/SKILL.md, diff:assets/skills/lore-plan/SKILL.md, diff:assets/skills/lore-product/SKILL.md, diff:assets/skills/lore/SKILL.md, diff:scripts/fresh-install-probe.ts, diff:scripts/lib/fresh-install-probe-steps.ts, diff:packages/lore/tests/unit/service/baseline-architecture-tree.test.ts, diff:packages/lore/tests/integration/cli/ac-cite-provenance-fresh.bun.test.ts, diff:packages/lore/tests/integration/cli/setup-baseline-adoption.bun.test.ts, diff:scripts/lib/fresh-install-probe-steps.ts
- Reasoning clipped for: AC-FIP-1, AC-FIP-2, AC-FIP-3, AC-FIP-4, AC-FIP-5, AC-FIP-6

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | AC-FIP-2 to 6 have attested passes, and the visible diffs implement the fixes. AC-FIP-1 is unevidenced here. |
| evidence_integrity | 72 | 0.65 | evidence | Every task has a red-first run and attested passes. AC-FIP-1 has no evidence, the AC-FIP-6 fail tails are truncated, and the probe source is unseen. |
| scope_fidelity | 85 | 0.7 | evidence | The changes map to AC-FIP-2 to 6. Small extras: a human status rules line and AS rule_states in baseline tree --states, both within BR-670. The manifest regeneration is expected. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-FIP-1 | AC-FIP-1 has 0 pass and 0 fail in this plan. The attestation lives in an external hotfix task that is not included, and the named test file is not in the diff. |
| outcome | minor | AC-FIP-5 | refusedIsNew is true for inline criteria on a refused spec create, so cite_line suggests 'lore ac add spec-born-uncited ...' for a spec that was never written (see packages/lore/tests/unit/service/cite-gate-create.test.ts). |
| evidence_integrity | minor | AC-FIP-6 | The probe source scripts/fresh-install-probe.ts is omitted, and the cause of the post-fix failures in runs [5] and [6] is truncated. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require each spec AC to have in-bundle evidence, or a linked attested record imported into the plan, before archival. | AC-FIP-1 cannot be verified from this bundle. |
| spec | Specify the refusal hint for criteria passed inline to a spec create, for example re-run create with --cite. | The current hint is not runnable when the spec does not exist. |

## Unverifiable Materials

- AC-FIP-1 evidence (task-hotfix-f1 attestation, review-tree-position-parentless.bun.test.ts): Not included in the bundle or the diff.
- scripts/fresh-install-probe.ts and scripts/lib/fresh-install-probe-steps.ts: Omitted from the diff, so the step coverage of AC-FIP-6 cannot be inspected.
- assets/skills/*/SKILL.md edits and ac-cite-provenance-fresh.bun.test.ts: Omitted; AC-FIP-2 and AC-FIP-3 content is judged only via the test results.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.74
