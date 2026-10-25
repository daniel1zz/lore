---
id: KN-437
type: knowledge
role: knowledge
title: "Assessment: Land defect-channel honesty: a resolution-keyed cap, two non-derogatory terminal states, corpus-naming reads, and AC oracle generations (2026-08-12)"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-10-23
tags: []
parent: PLAN-127
links:
  - {id: PLAN-127, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KZRHWMY320HF1Q8QD9ENQ6GT`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DC-1 | 92 | Attested RED (resolve exit 2) then attested green through the real CLI: '10 filed, 11th refused, all 10 resolved superseded/duplicate, then the 11th is ACCEPTED' plus a negative control that a FAILED resolve frees nothing. 3 pass / 2 attested, no contradicting run. | 01KZRHZBR636BJJ0RMGT0N1Q5S (M1+M3 task, evidence [2],[6],[13],[17]) |
| AC-DC-2 | 90 | RED observed on the missing structured payload, then green asserting one {id,resolution} per blocking report and quota_freeing_states derived from TERMINAL_ISSUE_RESOLUTIONS (set-derived, per the AC's anti-literal clause). Human-render cross-check asserted only via test names, not visible output. | 01KZRHZBR636BJJ0RMGT0N1Q5S (evidence [3],[7],[14],[18]) |
| AC-DC-3 | 84 | RED (upstream feedback config rejected by validation) then green: 6 tests incl. HAPPY N=3 and BOUNDARY N=1, proving the upstream corpus's own config sets the ceiling. Thinner trail than peers: 2 passes, 1 attested; core/src/config.ts change unseen. | 01KZRHZVHHZM9APZZSABGRGK87 (M2 task, evidence [1]-[3]) |
| AC-DC-4 | 92 | RED was the pre-fix refusal naming only rejected/wontfix; green shows 7 tests incl. 'superseded with NO --superseded-by exits 4 and leaves extra byte-identical'. The shown issue.ts diff independently confirms pre-write pointer resolution and re-typing to exit 4. | 01KZRHZBR636BJJ0RMGT0N1Q5S (evidence [4],[8],[15],[19]; diff commands/issue.ts) |
| AC-DC-5 | 90 | Attested RED on the 'Corpus: ' header contract, then 5 green tests incl. a zero-report BOUNDARY still naming the corpus. Set-equality of doc-id sets asserted only inside the omitted test file; test titles match the AC wording. | 01KZRSCTMVNCJT5E28ZX588D70 (M4+M6 task, evidence [1],[4],[9],[12]) |
| AC-DC-6 | 90 | Strong reverse control: RED showed upstream read returning 0 rows; green asserts '--local yields 0 rows naming the CONSUMER while the default yields 3 naming the UPSTREAM', so the source switch is genuinely exercised rather than both branches reading one corpus. | 01KZRSCTMVNCJT5E28ZX588D70 (evidence [2],[5],[10],[13]) |
| AC-DC-8 | 80 | 15 tests green after RED, and the shown core/acceptance.ts + ac-service.ts diff matches the claim (additive optional field, bump only on script command change, no row edited). Weakness: the RED tail is an agent-written prose summary, not raw output; 2 passes / 1 attested. | 01KZRHZW3V74B8JP5XME2T3E7K (M5 task, evidence [1],[2],[5]) |
| AC-DC-9 | 82 | Genuinely falsifiable: it went RED on the merged tree (2 construction sites, dashboard api.ts) and was fixed by eliminating the duplicate rather than narrowing scope. Final attested pass on main (8 tests). Score held back by the recorded attested FAIL in the trail. | 01KZRHZBR636BJJ0RMGT0N1Q5S (evidence [16] fail), 01KZRSCTMVNCJT5E28ZX588D70 (relocation task, evidence [1],[2],[9]) |
| AC-DC-7 | 78 | RED ('Unknown option: --severity') then 6 green tests incl. the NEGATIVE that an all-critical quota still refuses. Discounted because the render contract ('Severity'/'Category' column headings) was declared retroactively 2026-08-12 to match what shipped. | 01KZRSCTMVNCJT5E28ZX588D70 (evidence [3],[6],[11],[14]) |
| AC-DC-10 | 76 | RED then green with fixture-integrity controls, and the ac.ts diff shows the marker rendered from the fact verbatim. Discounted: only 1 recorded pass, the contract was declared retroactively 2026-08-12, and the same task recorded 'bun run test:changed' as fail with no follow-up green. | 01KZRMT8BMSETD23BGFQXETMHZ (evidence [1],[2],[3] fail) |
| AC-DC-11 | 72 | CLI-spawning oracle with an omit-when-prior_refs=0 control, RED then green. Weakest trail of the set: 1 pass only, the RED tail is a prose summary rather than raw output, and the contract was declared after the fact; task-feed-flow.ts change unseen. | 01KZRPT2NKJ0NBXDD4TJPFGR32 (feed task, evidence [1],[2]) |
| AC-DC-12 | 85 | Best-designed oracle here: synthetic-member injection makes tsc fail inside both shipped switch files, with untouched and unwidened-overlay controls. RED observed. Discounted for the retroactive text correction and an unresolved dashboard e2e failure in the same task. | 01KZRMT94GGWRZFT37NJ3EDXCY (dashboard task), 01KZRSCTMVNCJT5E28ZX588D70 (evidence [4],[7] e2e fail,[10]) |
| AC-DC-13 | 78 | RED ('resolveDeclaredAcCriteria is not a function') then 3 green covering both the port-follows behaviour discriminator and the zero-occurrence census. Only 1 pass; the diff shown still contains findGoverningAcceptanceCriteria and its removal is in an omitted revision of the same file. | 01KZRHZVRPYA715GV81C4DT8XM (port-widening task, evidence [1],[2]) |

## Gaps

- Broad-suite oracles recorded as fail are never re-run green: 'bun run test:changed' fails in three tasks and 'bun run test:vitest' in one, and the last task's 'bun --cwd=packages/dashboard run test:e2e' fails with packages/dashboard/tests/e2e/issues.spec.ts modified in the same change. Only targeted per-AC subsets are re-run afterwards, so no evidence shows the merged tree regression-free.
- packages/lore/src/adapters/http/issue-reports-routes.ts still documents the dashboard resolution mirror as 'currently STALE', claims the mirror type will not admit 'superseded', and directs readers to three sites that no longer construct a mirror after the relocation into @lore/core. The file is absent from the truncation manifest, so this comment was not corrected — documentation now contradicts the shipped design.
- The visible diff of packages/lore/src/service/task-workflow-service.ts still adds findGoverningAcceptanceCriteria and its 'BOUNDED second traversal' note, which AC-DC-13's census requires to be absent. A later revision of the same file is in the truncation manifest and the AC's test passes, so removal is credible but not directly verifiable from the materials shown.
- AC-DC-8 and AC-DC-11 record their expected-fail observation as an agent-composed prose summary ('12 assertion mismatches…', '6 fail / 4 pass: acceptance_detail undefined…') rather than raw captured output, so the RED rests on narration. AC-DC-10, AC-DC-11 and AC-DC-13 each have exactly one recorded pass.
- AC-DC-7, AC-DC-10, AC-DC-11 and AC-DC-12 all state their render contract was declared or corrected on 2026-08-12 'to match what shipped'. Contracts fitted to shipped behaviour cannot falsify the implementation they describe; their green runs confirm self-consistency more than conformance to an independently specified requirement.

## Recommendations

- Add a merge-gate step requiring one green run of the broad suites (test:changed, test:vitest, dashboard test:e2e) on the merged tree, recorded as evidence, before archiving the plan.
- Treat retroactively declared render contracts as a distinct evidence class: when an AC is reworded after the code lands, require a fresh falsification probe (mutate the renderer, observe red) alongside the green run.
- Require expected-fail evidence to carry the raw command tail; reject agent-authored summaries as the sole RED record.
- Update or delete the stale mirror JSDoc in issue-reports-routes.ts as part of closing AC-DC-12, and add a check that 'named gap' comments die with the gap (the pattern AC-DC-13 already enforces for one note).

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 109630ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/ac-oracle-generation.test.ts, diff:packages/lore/src/service/issue-report-service.ts, diff:packages/lore/src/service/issue-resolution.ts, diff:packages/lore/tests/integration/cli/issue-cap-quota-release.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-cap-refusal-message.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-resolve-pointer-required.bun.test.ts, diff:packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts, diff:packages/lore/tests/integration/cli/ac-oracle-generation-surface.bun.test.ts, diff:packages/core/src/config.ts, diff:packages/core/src/issue-report.ts, diff:packages/lore/src/service/issue-report-service.ts, diff:packages/lore/tests/integration/cli/issue-cap-configurable.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-service.test.ts, diff:packages/dashboard/src/components/IssueDetail.tsx, diff:packages/dashboard/src/components/IssuesList.tsx, diff:packages/dashboard/src/lib/api.ts, diff:packages/dashboard/tests/unit/issue-resolution-union-parity.test.ts, diff:packages/core/src/acceptance.test.ts, diff:packages/lore/tests/unit/adapters/task-feed-wiring.test.ts, diff:packages/lore/tests/unit/service/outline-service.test.ts, diff:packages/core/src/issue-resolution-vocab.ts, diff:packages/dashboard/src/lib/api.ts, diff:packages/dashboard/tests/unit/issue-resolution-union-parity.test.ts, diff:packages/lore/src/service/issue-resolution.ts, diff:packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts, diff:packages/core/src/issue-report.ts, diff:packages/dashboard/tests/e2e/issues.spec.ts, diff:packages/lore/src/adapters/cli/commands/issues.ts, diff:packages/lore/src/adapters/cli/commands/report-issue.ts, diff:packages/lore/src/adapters/cli/report-issue-wiring.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/flows/upstream-context-flow.ts, diff:packages/lore/src/service/issue-report-service.ts, diff:packages/lore/tests/e2e/issue-consumer-list.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-cap-refusal-message.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-read-surface-local-control.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-read-surfaces-agree.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-read-surfaces.shared.ts, diff:packages/lore/tests/integration/cli/issue-severity-ordering-only.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-service.test.ts, diff:packages/lore/src/adapters/cli/task-feed-wiring.ts, diff:packages/lore/src/flows/task-feed-flow.ts, diff:packages/lore/tests/integration/cli/feed-retired-oracle-visibility.bun.test.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/unit/service/ac-oracle-generation.test.ts, diff:packages/lore/tests/unit/service/ac-port-carries-criteria.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.72 | evidence | All 13 ACs carry a RED then an attested green through real CLI/unit oracles; discounted for retroactively declared render contracts and an unresolved dashboard e2e failure. |
| evidence_integrity | 72 | 0.75 | evidence | RED-first discipline and a real merged-tree AC-DC-9 red are credible, but 5 broad-suite/e2e fails go unresolved, two REDs are prose summaries, and attested ratio is 0.38. |
| scope_fidelity | 86 | 0.7 | evidence | Phases matched declared anchors; out-of-anchor gaps were named in JSDoc rather than silently widened, then closed by follow-up tasks. Some drift into core/ and dashboard/ beyond the 3-phase plan. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | Broad-suite oracles recorded as fail are never re-run green: 'bun run test:changed' fails in three tasks and 'bun run test:vitest' in one, and the last task's 'bun --cwd=packages/dashboard run test:e2e' fails with packages/dashboard/tests/e2e/issues.spec.ts modified in the same change. Only targeted per-AC subsets are re-run afterwards, so no evidence shows the merged tree regression-free. |
| outcome | minor | AC-DC-12 | packages/lore/src/adapters/http/issue-reports-routes.ts still documents the dashboard resolution mirror as 'currently STALE', claims the mirror type will not admit 'superseded', and directs readers to three sites that no longer construct a mirror after the relocation into @lore/core. The file is absent from the truncation manifest, so this comment was not corrected — documentation now contradicts the shipped design. |
| evidence_integrity | minor | AC-DC-13 | The visible diff of packages/lore/src/service/task-workflow-service.ts still adds findGoverningAcceptanceCriteria and its 'BOUNDED second traversal' note, which AC-DC-13's census requires to be absent. A later revision of the same file is in the truncation manifest and the AC's test passes, so removal is credible but not directly verifiable from the materials shown. |
| evidence_integrity | minor | AC-DC-11 | AC-DC-8 and AC-DC-11 record their expected-fail observation as an agent-composed prose summary ('12 assertion mismatches…', '6 fail / 4 pass: acceptance_detail undefined…') rather than raw captured output, so the RED rests on narration. AC-DC-10, AC-DC-11 and AC-DC-13 each have exactly one recorded pass. |
| outcome | minor | AC-DC-7 | AC-DC-7, AC-DC-10, AC-DC-11 and AC-DC-12 all state their render contract was declared or corrected on 2026-08-12 'to match what shipped'. Contracts fitted to shipped behaviour cannot falsify the implementation they describe; their green runs confirm self-consistency more than conformance to an independently specified requirement. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a merge-gate step requiring one green run of the broad suites (test:changed, test:vitest, dashboard test:e2e) on the merged tree, recorded as evidence, before archiving the plan. | Five recorded suite/e2e failures across four tasks have no green successor, so no evidence shows the integrated tree healthy. |
| process | Treat retroactively declared render contracts as a distinct evidence class: when an AC is reworded after the code lands, require a fresh falsification probe (mutate the renderer, observe red) alongside the green run. | Four ACs were fitted to shipped output on 2026-08-12; their passes cannot distinguish conformance from description. |
| process | Require expected-fail evidence to carry the raw command tail; reject agent-authored summaries as the sole RED record. | AC-DC-8 and AC-DC-11 REDs are narrated, weakening the RED-first attestation the plan's Verification section demands. |
| spec | Update or delete the stale mirror JSDoc in issue-reports-routes.ts as part of closing AC-DC-12, and add a check that 'named gap' comments die with the gap (the pattern AC-DC-13 already enforces for one note). | A comment describing a fixed defect as live is the same class of dishonesty this spec exists to remove. |

## Unverifiable Materials

- packages/lore/src/service/issue-report-service.ts, issue-resolution.ts, issue-resolution-vocab.ts, corpus-service.ts, task-feed-flow.ts and the 26 test files: Omitted from the diff by the truncation manifest; the cap narrowing, the SSOT vocabulary body, and every AC oracle's assertions were judged from evidence tails and test titles only.
- Human stderr render of the cap refusal (AC-DC-2) and the corpus_path set-equality assertion (AC-DC-5): Asserted inside omitted test files; only pass counts and test titles are visible.
- Whether packages/lore/src/flows/upstream-context-flow.ts's named rejection_reason gap was actually closed: The visible hunk still declares the gap; a later revision of that file exists but is omitted.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 10 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.38
