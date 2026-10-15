---
id: KN-598
type: knowledge
role: knowledge
title: "Assessment: Baseline close-out fixes (2026-10-10)"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-165
links:
  - {id: PLAN-165, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M4K40ERW9QZ1F3T1VF8RFBF9`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BLC-1 | 85 | One stamping point in all three stores. Surface comes from ALS for HTTP and MCP and from process state for the CLI. Test drives the real CLI, MCP handlers and HTTP with cookie and bearer, and also checks the hash chain. Red-first plus 2 attested passes. Unauthenticated HTTP writes in a CLI-booted p… | task-fix-128-audit-entries-record-the-write-surface (ev 1 expected-fail; ev 2,3 pass) |
| AC-BLC-2 | 88 | baselineLabelSchema refine trims labels and is shared by both write paths. addNode now validates tree against baselineTreeSchema. Test adds whitespace cases and the 'marketing' tree case, both checking VALIDATION_ERROR and an unchanged count. Red-first, then 33/33 pass. | task-fix-129-130-baseline-label-and-tree-validation (ev 1 expected-fail; ev 2,3 pass) |
| AC-BLC-3 | 62 | Red-first and green Playwright runs are recorded. No product-code diff is shown, so the fix seems to be in the omitted spec and seed fixture. I can't rule out that the test was weakened. The output tail is cut off, so I can't confirm the If-Match and byte-unchanged checks. | task-fix-multi-project-isolation-e2e-approve-on-project-a (ev 1 expected-fail; ev 2,3 pass; tail truncated) |
| AC-BLC-4 | 70 | The literal require('typescript') makes bun --compile embed the compiler. The compiled-binary test passes after the build. But the visible coverage test asserts exit 1 for an unmapped leaf, while the AC says exit 0. The red-first run (70-byte tail) skipped the build step. | task-fix-58-compiled-binary-runs-the-census (ev 1 expected-fail w/o build; ev 2,3 pass) |
| AC-BLC-5 | 90 | New v3 prompt renders the four parts verbatim. v2 stays frozen, and tests check v2 and v3 are byte-identical for a business leaf. Also covers debt-registry negative, empty exceptions and the cap count. The v2 registry test was updated. Red-first, then 10/10 pass. | task-fix-126-review-judge-sees-architecture-standard-four-parts (ev 1 expected-fail; ev 2-4 pass) |
| AC-BLC-6 | 74 | The CLI now picks rows by ruleIdPrefixOfNode instead of node==='leaf'. The service diff only changes a comment, so it's unclear whether counts for standard and debt-registry nodes are non-zero. The test file is omitted. Red-first, then pass. | task-fix-125-baseline-tree-shows-standard-and-debt-rule-counts (ev 1 expected-fail; ev 2,3 pass) |
| AC-BLC-7 | 80 | addLinkWithProvenance is atomic in SQLite (BEGIN IMMEDIATE), Turso (tx) and in memory (undo). The red-first failure output is concrete. The test is store-level, so the AC's 'command exits non-zero' isn't visibly checked, and the Turso path has no evidence. | task-fix-123-link-parent-is-atomic (ev 1 expected-fail w/ output; ev 2,3 pass) |
| AC-BLC-8 | 84 | Test source is read through extractTestFileTokens and the precheck roots, capped with a counted note. Unreadable files give not_seen, which is never judged and is counted and named in the CLI output. wrong_share semantics changed. The consumer baseline-fidelity test shows expected-fail with no late… | task-fix-117-fidelity-judge-sees-the-cited-test-code (ev 1,3 expected-fail; ev 2,4,5 pass) |

## Gaps

- The isolation fix appears only in packages/dashboard/tests/e2e/multi-project-isolation.spec.ts and packages/dashboard/tests/e2e/seed-multi-project-fixture.ts. I can't tell whether the test was weakened or whether the approve on project A now genuinely returns 2xx.
- packages/lore/tests/integration/cli/compiled-census.bun.test.ts asserts exit 1 for an unmapped-leaf coverage run, but the AC requires exit 0.
- packages/lore/src/service/rule-service.ts only changes a comment about rule-holding kinds. No change is visible that computes counts for standard or debt-registry nodes.
- packages/lore/tests/integration/cli/baseline-fidelity.bun.test.ts is recorded as expected-fail, and no later pass is recorded.

## Recommendations

- Attach output tails to expected-fail runs and record the post-merge full-suite run.
- Fix AC-BLC-4 so its exit code matches the intended behaviour for mapped and unmapped leaves.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 51604ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/store/link-parent-atomic.bun.test.ts, diff:packages/lore/tests/integration/cli/compiled-census.bun.test.ts, diff:packages/lore/tests/integration/cli/baseline-tree-counts.bun.test.ts, diff:packages/dashboard/tests/e2e/multi-project-isolation.spec.ts, diff:packages/dashboard/tests/e2e/seed-multi-project-fixture.ts, diff:packages/lore/tests/integration/cli/baseline-fidelity.bun.test.ts, diff:packages/lore/tests/unit/service/fidelity-judge-test-code.test.ts
- Reasoning clipped for: AC-BLC-1, AC-BLC-8

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.65 | evidence | All 8 ACs have product fixes and green tests. Gaps: AC-BLC-3 shows no visible product fix, AC-BLC-4's exit-code wording doesn't match, and AC-BLC-6's service counts are unverified. |
| evidence_integrity | 72 | 0.6 | evidence | Red-first recorded for every task, but most expected-fail runs lack output tails. AC-BLC-4's red run skipped the build. Attested ratio is 0.69, and the fidelity consumer test has no pass recorded. |
| scope_fidelity | 85 | 0.7 | evidence | Changes map to the 8 issues. The audit surface touches all stores and adapters, which is justified. Behaviour changes (v3 prompt, wrong_share) follow from the ACs. A docs table was updated. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-BLC-3 | The isolation fix appears only in packages/dashboard/tests/e2e/multi-project-isolation.spec.ts and packages/dashboard/tests/e2e/seed-multi-project-fixture.ts. I can't tell whether the test was weakened or whether the approve on project A now genuinely returns 2xx. |
| outcome | minor | AC-BLC-4 | packages/lore/tests/integration/cli/compiled-census.bun.test.ts asserts exit 1 for an unmapped-leaf coverage run, but the AC requires exit 0. |
| outcome | minor | AC-BLC-6 | packages/lore/src/service/rule-service.ts only changes a comment about rule-holding kinds. No change is visible that computes counts for standard or debt-registry nodes. |
| evidence_integrity | minor | AC-BLC-8 | packages/lore/tests/integration/cli/baseline-fidelity.bun.test.ts is recorded as expected-fail, and no later pass is recorded. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Attach output tails to expected-fail runs and record the post-merge full-suite run. | Most red-first runs show no output, and the risk register's mitigation is unevidenced. |
| spec | Fix AC-BLC-4 so its exit code matches the intended behaviour for mapped and unmapped leaves. | The test and AC disagree. |

## Unverifiable Materials

- packages/dashboard/tests/e2e/multi-project-isolation.spec.ts diff: Omitted. I can't judge where the AC-BLC-3 fix landed or whether its assertions are intact.
- packages/lore/tests/integration/cli/baseline-tree-counts.bun.test.ts: Omitted. I can't confirm the counts are non-zero.
- Full test suite run on main: No evidence record.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 5
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.69
