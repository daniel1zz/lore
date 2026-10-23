---
id: KN-347
type: knowledge
role: knowledge
title: "Assessment: Implementation — out-of-box reporting channel (self-provision + SPEC-073 hint unlock) (2026-07-29)"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-10-23
tags: []
parent: PLAN-105
links:
  - {id: PLAN-105, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYP8SVY4E1S9CGAM43Q3EQ1H`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-OOB-1 | 88 | Multiple attested passes of the -t 'AC-OOB-1' oracle across T1/T2/T3 records, with output_tail naming exit 4, the literal --auto-config command, and zero 'corpus_path: /path/to' template guidance. Only gap: no diff to confirm the message SSOT. | task-t1-red-provision-integration-suite-ac-oob-1-5 (attested pass, output_tail shows both sub-cases), task-t4-cli-auto-config-flag-actionable-unconfigured-error (CLI wiring, AC-OOB-1 pass) |
| AC-OOB-2 | 84 | 6 attested passes; output_tail confirms FeedbackConfigSchema-clean write, upstream draft task, exit 0, plus a 3-hop symlink boundary case. Passed only after T8 fixed a realpath assertion; the pre-T8 failures were fixture-side per T8's report, unverifiable without the diff. | task-t3-core-upstream-resolver-config-writer (20/20 in-process wiring suite + later attested AC-OOB-2 passes), task-t8-fix-macos-realpath-assumption-in-three-provision-suite (assertion fix; only tests changed per task text) |
| AC-OOB-3 | 86 | 6 attested passes; output_tail states exit 4 naming the unresolved item and byte-identical consumer config.yaml. Negative oracle is concrete and repeated across sessions. | task-t4-cli-auto-config-flag-actionable-unconfigured-error (1 pass / 3 expect() calls) |
| AC-OOB-4 | 83 | 6 attested passes covering 4a (byte-identical no-op on configured corpus) and 4b (top-level key preservation). 4b initially failed on the realpath fixture issue; green only post-T8, and the key-preservation claim rests on test output tails alone. | task-t3-core-upstream-resolver-config-writer (idempotent no-op + key-preservation cases in wiring suite) |
| AC-OOB-5 | 85 | 6 attested passes; identity-pin rejection (readable .lore/lore.db, wrong root PRD) exits 4 with the found slug named and no config written, verified both in-process (T3) and via the spawned binary (T4). | task-t3-core-upstream-resolver-config-writer ('ERROR: wrong root-PRD identity' case), task-t4-cli-auto-config-flag-actionable-unconfigured-error (CLI-seam pass, 4 expect() calls) |
| AC-OOB-6 | 68 | Weakest trail: 3 attested fails vs 3 attested passes. Genuinely RED-then-GREEN, and T9 reproduced/fixed the LORE_ACTOR non-hermeticity and re-ran under a stripped env (the real lore verify condition) — but that decisive run is self-reported, not attested. | task-t9-make-the-hint-suite-hermetic-actor-advisory-pollutes (env -i run 1 pass / 0 fail, self-reported), task-t7-reconcile-the-two-spec-073-baseline-sub-cases-that-spec (supersession of two AC-073 sub-cases retargeted, not deleted) |
| AC-OOB-7 | 87 | bun run typecheck attested pass 6 times across tasks; output_tail shows all five tsc projects (core, lore, lore-tests, scripts, dashboard) running to completion. | task-t3-core-upstream-resolver-config-writer (full typecheck chain in output_tail) |

## Gaps

- AC-OOB-6 carries 3 attested failures and 3 attested passes. The run that actually resolves the contradiction — T9's stripped-env `env -i PATH=... bun test ... -t 'AC-OOB-6'`, which is what lore verify does — is self-reported only. The AC's green state therefore rests on an unattested record.
- T4 records evidence with commands literally 'x', 'x3', 'x4' all marked result=pass. These are non-reproducible and pollute the trail; an auditor cannot distinguish them from real oracle runs except by inspection.
- T6, the closing gate for the plan's Exit Criteria (clean tree, named commit, full two-runner suite, code anchors), has one self-reported evidence record and zero attested ones. The clean-tree/commit claim and the anchor declaration are both unverifiable from these materials.
- Plan invariants 1 (resolveFeedbackUpstreamCfg remains the only feedback.upstream read site), 2 (FeedbackConfigSchema untouched) and 3 (configured-branch wording byte-frozen) are all specified as verified-by-diff. No diff was provided, so none can be confirmed; invariant 3 has partial behavioural cover via AC-OOB-6 direction 2.
- AC-OOB-2/4 green depends on T8's edit to three corpus_path assertions (raw mkdtemp path -> realpathSync). The rationale is plausible and corroborated by a sibling suite that already asserted realpath, but relaxing an assertion to reach green is exactly the move that needs diff review, and none is available.
- Zero knowledge docs linked. The verify-env allowlist gap (T9) and the macOS realpath assertion pattern (T8) are both reusable, cross-suite hazards that will be rediscovered by the next session.

## Recommendations

- Require the decisive oracle for an AC to be attested when that AC has any attested failures, so a self-reported pass cannot flip a contradicted ledger. Re-run AC-OOB-6 under the stripped env with attestation.
- Reject evidence records whose command field is not a runnable command (e.g. 'x', 'x3', 'x4') at record time, and purge the three existing ones on T4.
- For invariants specified as 'verified by diff', add an explicit mechanical oracle (e.g. a grep-count script over config.feedback read sites, and a byte-hash pin on the configured-branch wording) rather than relying on a human diff read.
- Capture the LORE_ACTOR / DEFAULT_VERIFY_ENV_ALLOWLIST hermeticity trap and the macOS /var->/private/var realpath assertion trap as knowledge docs, and add the T9 sweep result (other exact-stderr assertions) to them.
- Make code-anchor declaration its own evidenced step (record the lore anchor add invocation) instead of folding it into a closing task whose only evidence is a test run.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 72742ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All 7 ACs end green with attested oracle runs; RED-then-GREEN order observed and the two superseded SPEC-073 sub-cases were retargeted, not deleted. No diff to confirm implementation quality. |
| evidence_integrity | 62 | 0.75 | evidence | Rich output_tails and repeated attestation, but attested ratio 0.56, three placeholder 'x' commands recorded as pass, and the closing full-suite plus AC-OOB-6's decisive hermetic run are self-reporte… |
| scope_fidelity | 70 | low | absence | Task anchors and refusals (T3 declining to touch report-issue.ts) read as disciplined, but with diff_available=false and tests_touched=false no file-level check of the invariants is possible. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-OOB-6 | AC-OOB-6 carries 3 attested failures and 3 attested passes. The run that actually resolves the contradiction — T9's stripped-env `env -i PATH=... bun test ... -t 'AC-OOB-6'`, which is what lore verify does — is self-reported only. The AC's green state therefore rests on an unattested record. |
| evidence_integrity | major | — | T4 records evidence with commands literally 'x', 'x3', 'x4' all marked result=pass. These are non-reproducible and pollute the trail; an auditor cannot distinguish them from real oracle runs except by inspection. |
| evidence_integrity | major | — | T6, the closing gate for the plan's Exit Criteria (clean tree, named commit, full two-runner suite, code anchors), has one self-reported evidence record and zero attested ones. The clean-tree/commit claim and the anchor declaration are both unverifiable from these materials. |
| scope_fidelity | major | — | Plan invariants 1 (resolveFeedbackUpstreamCfg remains the only feedback.upstream read site), 2 (FeedbackConfigSchema untouched) and 3 (configured-branch wording byte-frozen) are all specified as verified-by-diff. No diff was provided, so none can be confirmed; invariant 3 has partial behavioural cover via AC-OOB-6 direction 2. |
| outcome | minor | AC-OOB-2 | AC-OOB-2/4 green depends on T8's edit to three corpus_path assertions (raw mkdtemp path -> realpathSync). The rationale is plausible and corroborated by a sibling suite that already asserted realpath, but relaxing an assertion to reach green is exactly the move that needs diff review, and none is available. |
| outcome | minor | — | Zero knowledge docs linked. The verify-env allowlist gap (T9) and the macOS realpath assertion pattern (T8) are both reusable, cross-suite hazards that will be rediscovered by the next session. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the decisive oracle for an AC to be attested when that AC has any attested failures, so a self-reported pass cannot flip a contradicted ledger. Re-run AC-OOB-6 under the stripped env with attestation. | AC-OOB-6 currently sits at 3 attested pass / 3 attested fail; its resolution is self-reported. |
| process | Reject evidence records whose command field is not a runnable command (e.g. 'x', 'x3', 'x4') at record time, and purge the three existing ones on T4. | Unrunnable commands recorded as pass are indistinguishable from real oracles and silently inflate coverage counts. |
| plan | For invariants specified as 'verified by diff', add an explicit mechanical oracle (e.g. a grep-count script over config.feedback read sites, and a byte-hash pin on the configured-branch wording) rather than relying on a human diff read. | Invariants 1–3 are unverifiable whenever the diff is absent from the audit bundle. |
| process | Capture the LORE_ACTOR / DEFAULT_VERIFY_ENV_ALLOWLIST hermeticity trap and the macOS /var->/private/var realpath assertion trap as knowledge docs, and add the T9 sweep result (other exact-stderr assertions) to them. | Both cost a full remediation task this slice and generalize to any spawned-binary suite. |
| plan | Make code-anchor declaration its own evidenced step (record the lore anchor add invocation) instead of folding it into a closing task whose only evidence is a test run. | T6 claims anchors were declared but carries no evidence of it; undeclared anchors read as instant file_missing later. |

## Unverifiable Materials

- Implementation diff (report-issue-wiring.ts, commands/report-issue.ts, packages/core/src/config.ts): diff_available=false; no source shown, so plan invariants 1, 2 and 3 and the quality of the resolver/writer cannot be inspected.
- T6 clean-tree full-suite run at commit 99d5dea: Single self-reported evidence record with no attestation; the tree state, commit and 387/6624 + 1524 counts cannot be independently confirmed.
- Code-anchor declaration for the spec (lore anchor add): Named as a T6 deliverable but no evidence record of it exists in the bundle.
- T8's three assertion edits: Change is described in prose only; without the diff there is no confirmation that no other assertion was relaxed and no src/ file touched.
- Attested stripped-env run of AC-OOB-6: T9's env -i run is recorded as self-reported; no attested run under the verify-equivalent environment appears.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 9 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.56
