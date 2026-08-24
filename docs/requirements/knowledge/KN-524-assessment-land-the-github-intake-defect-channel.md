---
id: KN-524
type: knowledge
role: knowledge
title: "Assessment: Land the GitHub-intake defect channel: runner, cap removal, intake, migration, transport removal, projection (2026-08-24)"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-138
links:
  - {id: PLAN-138, type: informs}
---
# Assessment: partially_met (74/100)

Scope: plan `01M0Q10DWA0J2BS9HDRBVQ41HS`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-GI-7 | 88 | Two attested lint passes of the single-spawn-site scan; gh-runner.ts in diff genuinely imports node:child_process and is the only module naming gh subcommands. Spec itself records the concatenation-evasion boundary the oracle cannot measure. | 01M0Q12BY2VGN8J37HMZC78520 (lint scan pass), 01M0Q62M5WCZP6M6HYFJ81G6XV (re-run after label port landed) |
| AC-GI-9 | 85 | Four attested passes incl. the simultaneous case-sensitive/lowercase-key check. Two follow-up tasks show the symbol scan missed behaviour-level cap assertions (e2e and severity files), fixed with recorded pass evidence; symbol clearance itself is verified. | 01M0Q15YGQFP1CVEVXN5QD8FK2 (0 matches + simultaneous key survival), 01M0Q179NFXB39XCH5A9ZA4G94 (AC-DC-17 retirement), 01M0QC0W3YWMZGYEKGQVCCF7EE (severity-ordering-only pass) |
| AC-GI-1 | 82 | Red (exit non-zero) then 5/5 green on the live e2e against a dedicated repo, recorded by both the test and implement tasks. Wiring-mutation counter-test recorded expected-fail, evidencing the import is load-bearing. Port source itself is unseen (truncated). | 01M0Q19QZ5J71J2CR7HTGNH466 (red then 5 pass), 01M0QB34N4STDA9TQFDJ68CEHA (e2e pass + mutation expected-fail) |
| AC-GI-2 | 84 | gh-runner-auth 5/5 attested pass; diff shows both remedy literals (cli.github.com, gh auth login) constructed only in gh-runner.ts and AUTH_REQUIRED mapped to exit 8 in utils.ts. setup --check probe landed with 5/5 pass; no live gh-absent run shown. | 01M0Q12BY2VGN8J37HMZC78520 (auth taxonomy pass), 01M0Q141PHYXR3PB0AD7188YER (setup --check health probe) |
| AC-GI-3 | 78 | Red then 5/5 pass on receipt-log-v2.test.ts; diff shows intent-before-call two-phase log, legacy v1 tolerance and corrupt-line reporting matching the scenarios. Only one attested pass record; end-to-end intent-without-outcome under real failure asserted by the port task, not here. | 01M0Q15YT7PTN2XCS8WA5R0QQ1 (red), 01M0Q15Z49X6G56DHECJVC25FP (5 pass) |
| AC-GI-4 | 80 | 19/19 projector + 8 label-port tests, an app-wiring bun test, a mutation counter-test proving createApp assignment is load-bearing, plus a manual live gh read-back showing stale-label convergence. One of five records is manual/self-reported, not scripted. | 01M0Q62M5WCZP6M6HYFJ81G6XV (wiring + manual read-back + mutation), 01M0Q19SSXMEVP2771ERSSTN76 (projector 19 pass) |
| AC-GI-5 | 72 | 7/7 attested pass on resolution-label-non-authority.test.ts after a recorded red. Unit-scope only: the AC's `lore issues --verify` CLI surface is asserted through a vitest unit file, and the implementing source is truncated, so CLI-level divergence exit code is unverified here. | 01M0Q19TEH4G90NM0SE6SJ6S4G (AC-GI-5 pass), 01M0Q19T42RYR8S0WHN8JC5KR1 (red) |
| AC-GI-6 | 82 | Red then 8/8 pass; diff shows issue-front-matter.ts taking home/username as parameters (seeded, not ambient), dropping the os-fallback tier entirely and single-line JSON front matter that survives newline/`---` values. Core-scoped tsc pass plus barrel-isolation test. | 01M0Q15ZFPM7F5MKPHFFGA8Q5Z (red), 01M0Q15ZSRC5XTHC50AZ174PA7 (8 pass + barrel isolation) |
| AC-GI-8 | 74 | Attested pass, and the diff's scrubGhEnv deletes all four GH_* keys as own properties on every run(). But the oracle is a single vitest case covering one invocation shape; 'every invocation' is inferred from code structure rather than measured across call sites. | 01M0Q12BY2VGN8J37HMZC78520 (env-scrub 1 test pass) |
| AC-GI-10 | 82 | Red (2 failing) then 4/4 pass, including the mandatory strict-mode scenario that blocks a blanket .passthrough(). Simultaneous scan evidence confirms the lowercase key survives while the six symbols are gone. | 01M0Q141APJ8Y3T1914YHM106T (red), 01M0Q15YGQFP1CVEVXN5QD8FK2 (4 pass + simultaneous scan) |
| AC-GI-11 | 70 | Red then attested e2e pass with the AC-GI-11 echo; tails show dry-run zero-gh-call and no-local-receipt cases. Field-by-field corpus equality and the 2-closed-with-state_reason assertions are inside the truncated test file and migration script, so only the runner verdict is visible. | 01M0Q19RF6WWEM7HHKNC2ZTX22 (red), 01M0Q19TEH4G90NM0SE6SJ6S4G (note: migration pass recorded on migration task) |
| AC-GI-12 | 72 | 5/5 attested pass after a recorded red on issue-read-batching.test.ts. Call-count equality for 50 vs 1 is asserted at unit level with an injected runner; the batched read implementation (commands/issues.ts) is truncated, so the production path's O(1) claim is not directly visible. | 01M0Q19TEH4G90NM0SE6SJ6S4G (AC-GI-12 pass) |
| AC-GI-13 | 88 | Guard green on unmodified HEAD (4/4) plus a mutation counter-test that injects the GitHub back door and shows the guard turning red — strong anti-vacuity evidence. Not re-run at the P6 gate, which is the AC's stated later obligation. | 01M0Q12BDD1X84APX46QT70D8K (pass + injected-backdoor expected-fail) |
| AC-GI-14 | 78 | Red (3 failing) then 4/4 pass including the strict-mode-survives scenario. Diff does not show the transport deletion or config change (truncated), and the task's own AC of a full-repo typecheck plus full-suite pass carries no recorded oracle. | 01M0Q19RS7C584PZZPQ1RBQW47 (red), 01M0Q19S30XFD2KVNARPN595BV (4 pass) |

## Gaps

- The final verification task is status=draft with has_evidence=false: no full-suite run on merged main with the turbo cache defeated, no `lore verify` attestation sweep, no anchor/drift chain, and no post-migration re-run of the AC-GI-13 guard. The plan's own Exit Criteria are therefore undischarged, and it is exactly this full-suite obligation that the plan says is needed to catch behaviour-level cap assertions a symbol scan cannot see.
- Invariant 1's full-repo typecheck exit 0 has no passing record anywhere: task 01M0Q12BY2VGN8J37HMZC78520 and 01M0Q15Z49X6G56DHECJVC25FP both record `bun run typecheck` result=fail, and the cap-removal task records a baseline-diff argument (errors byte-identical before/after) rather than exit 0. The transport-removal task's AC also demands a full-repo typecheck and full-suite pass with no such record.
- AC-GI-5 names `lore issues --verify` behaviour (divergence named, divergence exit code, zero writes) but its only oracle is a vitest unit file, packages/lore/tests/unit/service/resolution-label-non-authority.test.ts, with the implementing CLI source packages/lore/src/adapters/cli/commands/issues.ts truncated from the diff. A unit-level detector can pass while the CLI flag mis-wires the exit code.
- AC-GI-12's O(1)-call property is measured only in packages/lore/tests/unit/service/issue-read-batching.test.ts against an injected runner. The production read path in packages/lore/src/adapters/cli/commands/issues.ts is not shown, so nothing in the visible materials rules out the CLI taking a different, per-issue path than the unit-tested function.
- One of AC-GI-4's five records is oracle=manual (a live gh api read-back against daniel1zz/lore-e2e-target issue #2, plus a 404 failure-path narration). The stale-label convergence and loud-failure claims in the task's ACs rest on that self-reported record rather than a re-runnable script.
- AC-GI-8 claims all four GH_* vars are absent from EVERY invocation env, but the oracle is a single vitest case (1 test) in packages/lore/tests/unit/service/gh-runner-env-scrub.test.ts. The property holds structurally because scrubGhEnv is applied inside GhRunner.run in packages/lore/src/service/gh-runner.ts, yet 'every invocation' is inferred from code reading, not measured.
- Knowledge capture is zero linked docs for a six-phase irreversible migration whose execution produced at least three durable lessons the plan text itself records inline: the TDD-wave vs full-repo-typecheck invariant conflict, symbol-scan vs behaviour-assertion complementarity, and the four-edge critical-path derivation defect. None was promoted out of the plan body.

## Recommendations

- Execute the P6 verification task on merged main and record its oracles (full suite under both runners with --force, lore verify sweep, status --check-tree --check-drift, audit --verify, AC-GI-13 re-run) before declaring the plan landed.
- Re-anchor AC-GI-5 and AC-GI-12 oracles onto CLI-level bun tests that invoke `lore issues --verify` and `lore issues --severity ...`, asserting exit codes and the printed total, instead of vitest unit files over service functions.
- Require a scripted replacement for any oracle=manual evidence record before an AC is considered discharged; convert the AC-GI-4 live label read-back into a bun e2e against the dedicated target repo.
- State Invariant 1's phase-gate discharge as an explicit evidence obligation with its own recorded oracle, rather than allowing per-task baseline-diff substitutes to stand in for exit 0.
- Emit knowledge docs for the two reusable lessons recorded inline in the plan: TDD-wave sibling RED files making full-repo typecheck unsatisfiable, and symbol-clearance scans being blind to behaviour-level assertions.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 235216ms
- Retried: true
- Truncated sections: plan, diff:packages/lore/tests/unit/service/github-close-not-fixed.test.ts, diff:packages/lore/tests/unit/service/receipt-log-v2.test.ts, diff:packages/lore/tests/unit/service/feedback-config-compat.test.ts, diff:packages/lore/tests/unit/service/issue-body-redaction.test.ts, diff:packages/lore/tests/unit/service/transport-config-compat.test.ts, diff:packages/lore/tests/unit/service/gh-runner-auth.test.ts, diff:packages/lore/tests/unit/service/gh-runner-env-scrub.test.ts, diff:packages/lore/tests/unit/service/resolution-projector.test.ts, diff:packages/lore/tests/unit/cli/setup-health-check.test.ts, diff:packages/lore/src/adapters/cli/setup-github-health.ts, diff:packages/core/src/config.ts, diff:packages/core/src/issue-report.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/adapters/cli/report-issue-wiring.ts, diff:packages/lore/src/adapters/http/issue-reports-routes.ts, diff:packages/lore/src/flows/upstream-context-flow.ts, diff:packages/lore/src/service/issue-report-service.ts, diff:packages/lore/src/service/issue-resolution.ts, diff:packages/lore/tests/integration/cli/issue-cap-configurable.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-cap-quota-release.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-cap-refusal-message.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/adhoc-ac-scope-floor-doc-invariants.test.ts, diff:packages/lore/tests/unit/service/feedback-config-compat.test.ts, diff:packages/lore/tests/unit/service/issue-body-redaction.test.ts, diff:packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-service.test.ts, diff:packages/lore/tests/unit/service/issue-resolution.test.ts, diff:packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts, diff:packages/lore/tests/unit/store/schema-probe.bun.test.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/resolution-label-port.ts, diff:packages/lore/tests/integration/resolution-projector-app-wiring.bun.test.ts, diff:packages/lore/tests/unit/service/resolution-label-port.test.ts, diff:packages/lore/tests/integration/cli/github-intake-reach.bun.test.ts, diff:packages/lore/tests/unit/service/issue-read-batching.test.ts, diff:packages/lore/tests/unit/service/resolution-label-non-authority.test.ts, diff:packages/lore/tests/integration/cli/issue-migration.bun.test.ts, diff:packages/core/src/config.ts, diff:packages/lore/src/adapters/cli/commands/issues.ts, diff:packages/lore/src/adapters/cli/commands/report-issue.ts, diff:packages/lore/src/adapters/cli/report-issue-wiring.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/service/github-intake-port.ts, diff:packages/lore/tests/integration/report-issue-wiring-provision.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/github-intake-port-wiring.test.ts, diff:packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/issues.ts, diff:scripts/migrate-issue-reports.ts, diff:packages/lore/tests/integration/cli/issue-severity-ordering-only.bun.test.ts, diff:packages/core/src/config.ts, diff:packages/core/src/issue-report.ts, diff:packages/core/src/issue-resolution-vocab.ts, diff:packages/lore/src/adapters/cli/commands/issues.ts, diff:packages/lore/src/adapters/cli/commands/report-issue.ts, diff:packages/lore/src/adapters/cli/report-issue-hint.ts, diff:packages/lore/src/adapters/cli/report-issue-wiring.ts, diff:packages/lore/src/adapters/http/issue-reports-routes.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/src/flows/upstream-context-flow.ts, diff:packages/lore/src/mount/mount-registry.ts, diff:packages/lore/src/service/github-intake-port.ts, diff:packages/lore/src/service/issue-report-service.ts, diff:packages/lore/src/service/issue-resolution.ts, diff:packages/lore/src/store/CLAUDE.md, diff:packages/lore/src/store/schema-probe.ts, diff:packages/lore/src/store/schema-version.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts, diff:packages/lore/tests/e2e/issue-consumer-list.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-read-surface-local-control.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-read-surfaces-agree.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-read-surfaces.shared.ts, diff:packages/lore/tests/integration/cli/issue-report-concurrency.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-resolve-pointer-required.bun.test.ts, diff:packages/lore/tests/integration/cli/issue-severity-ordering-only.bun.test.ts, diff:packages/lore/tests/integration/report-issue-provision.bun.test.ts, diff:packages/lore/tests/integration/report-issue-wiring-provision.bun.test.ts, diff:packages/lore/tests/unit/adapters/report-issue-hint.bun.test.ts, diff:packages/lore/tests/unit/adapters/report-issue-single-remedy.bun.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/issue-read-batching.test.ts, diff:packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-service.test.ts, diff:packages/lore/tests/unit/service/resolution-label-non-authority.test.ts, diff:packages/lore/tests/unit/store/schema-probe.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | All 14 ACs carry pass evidence and the diff shows real wiring (createApp projector, intake port, exit-code taxonomy). Weakness is CLI-level vs unit-level oracle scope and the unfinished P6 gate. |
| evidence_integrity | 76 | 0.75 | evidence | Strong red-then-green pairs and several mutation counter-tests proving non-vacuity. Offset by 0.76 attestation ratio, one manual record, two recorded typecheck failures, and a draft P6. |
| scope_fidelity | 86 | 0.7 | evidence | Work tracks the six declared phases; config keys .optional()-ised not deleted; two extra test-repair tasks are disclosed with reasons. Invariant 1 was revised mid-execution, openly recorded. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | blocker | AC-GI-9 | The final verification task is status=draft with has_evidence=false: no full-suite run on merged main with the turbo cache defeated, no `lore verify` attestation sweep, no anchor/drift chain, and no post-migration re-run of the AC-GI-13 guard. The plan's own Exit Criteria are therefore undischarged, and it is exactly this full-suite obligation that the plan says is needed to catch behaviour-level cap assertions a symbol scan cannot see. |
| evidence_integrity | major | AC-GI-14 | Invariant 1's full-repo typecheck exit 0 has no passing record anywhere: task 01M0Q12BY2VGN8J37HMZC78520 and 01M0Q15Z49X6G56DHECJVC25FP both record `bun run typecheck` result=fail, and the cap-removal task records a baseline-diff argument (errors byte-identical before/after) rather than exit 0. The transport-removal task's AC also demands a full-repo typecheck and full-suite pass with no such record. |
| outcome | major | AC-GI-5 | AC-GI-5 names `lore issues --verify` behaviour (divergence named, divergence exit code, zero writes) but its only oracle is a vitest unit file, packages/lore/tests/unit/service/resolution-label-non-authority.test.ts, with the implementing CLI source packages/lore/src/adapters/cli/commands/issues.ts truncated from the diff. A unit-level detector can pass while the CLI flag mis-wires the exit code. |
| outcome | minor | AC-GI-12 | AC-GI-12's O(1)-call property is measured only in packages/lore/tests/unit/service/issue-read-batching.test.ts against an injected runner. The production read path in packages/lore/src/adapters/cli/commands/issues.ts is not shown, so nothing in the visible materials rules out the CLI taking a different, per-issue path than the unit-tested function. |
| evidence_integrity | minor | AC-GI-4 | One of AC-GI-4's five records is oracle=manual (a live gh api read-back against daniel1zz/lore-e2e-target issue #2, plus a 404 failure-path narration). The stale-label convergence and loud-failure claims in the task's ACs rest on that self-reported record rather than a re-runnable script. |
| outcome | minor | AC-GI-8 | AC-GI-8 claims all four GH_* vars are absent from EVERY invocation env, but the oracle is a single vitest case (1 test) in packages/lore/tests/unit/service/gh-runner-env-scrub.test.ts. The property holds structurally because scrubGhEnv is applied inside GhRunner.run in packages/lore/src/service/gh-runner.ts, yet 'every invocation' is inferred from code reading, not measured. |
| scope_fidelity | minor | AC-GI-11 | Knowledge capture is zero linked docs for a six-phase irreversible migration whose execution produced at least three durable lessons the plan text itself records inline: the TDD-wave vs full-repo-typecheck invariant conflict, symbol-scan vs behaviour-assertion complementarity, and the four-edge critical-path derivation defect. None was promoted out of the plan body. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Execute the P6 verification task on merged main and record its oracles (full suite under both runners with --force, lore verify sweep, status --check-tree --check-drift, audit --verify, AC-GI-13 re-run) before declaring the plan landed. | It is the only phase where Invariant 1 and post-migration regression can be discharged; it is currently draft with zero evidence. |
| spec | Re-anchor AC-GI-5 and AC-GI-12 oracles onto CLI-level bun tests that invoke `lore issues --verify` and `lore issues --severity ...`, asserting exit codes and the printed total, instead of vitest unit files over service functions. | Both ACs' statements are about a user-facing CLI surface; unit oracles can pass while the flag wiring is wrong. |
| process | Require a scripted replacement for any oracle=manual evidence record before an AC is considered discharged; convert the AC-GI-4 live label read-back into a bun e2e against the dedicated target repo. | A manual record cannot be re-run at the phase gate, so it cannot detect a later regression the way the AC intends. |
| plan | State Invariant 1's phase-gate discharge as an explicit evidence obligation with its own recorded oracle, rather than allowing per-task baseline-diff substitutes to stand in for exit 0. | Three tasks recorded typecheck failures or substitutes; no record shows full-repo exit 0 anywhere in the trail. |
| process | Emit knowledge docs for the two reusable lessons recorded inline in the plan: TDD-wave sibling RED files making full-repo typecheck unsatisfiable, and symbol-clearance scans being blind to behaviour-level assertions. | Zero knowledge docs are linked; both lessons are already written up in prose but not captured as retrievable artifacts. |

## Unverifiable Materials

- packages/lore/src/service/github-intake-port.ts: Truncated from the diff; the frontMatterCodec/ReceiptLogV2 call-then-use structural claim can only be inferred from the mutation counter-test tail.
- packages/lore/src/adapters/cli/commands/issues.ts: Truncated; the --verify divergence exit code, filtered-total honesty and batched listing implementation are not visible.
- scripts/migrate-issue-reports.ts: Truncated; the create-then-PATCH sequence, concurrency and corpus-record update are only evidenced by the e2e runner verdict.
- packages/lore/src/service/resolution-label-port.ts: Truncated; label convergence (stale sibling removal) is evidenced by unit counts and a manual read-back, not visible source.
- packages/lore/src/adapters/cli/setup-github-health.ts: Truncated; the four health conditions and read-only guarantee are inferred from the setup.ts wiring shown in the diff.
- packages/core/src/config.ts: Truncated across three revisions; the .optional()-with-warning treatment of retired cap and transport keys is evidenced only by test verdicts.
- Merged-main state and full-suite result: All evidence tails show worktree paths; no post-merge run on main is recorded anywhere in the trail.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 14 declared criteria
- Task evidence: 25 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.76
