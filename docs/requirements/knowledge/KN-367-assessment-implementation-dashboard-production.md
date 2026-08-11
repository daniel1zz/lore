---
id: KN-367
type: knowledge
role: knowledge
title: "Assessment: Implementation — dashboard production packaging (F5a one-command lore dashboard) (2026-07-28)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
links:
  - {id: PLAN-112, type: informs}
---
# Assessment: partially_met (82/100)

Scope: plan `01KYM0RRWAXXXFBATXPKNG9YGT`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-F5A-1 | 85 | Final orchestrator `lore verify` run (evidence 13, 22) attests AC-F5A-1 pass at a named clean-worktree commit; static e2e 'packaged serve' group green (5 tests incl. no-vite process assert). Earlier fails are pre-implementation RED/config-absent, expected in an artifact chain. | task-skill-review-f5a-final-verification-and-assessment (evidence 13/22 lore verify 8 passed; 14 packaged serve green), task-skill-test-f5a-single-process-static-e2e-harness |
| AC-F5A-2 | 85 | Nonce group attested green post GAP-1 fix (session FK against api_keys). 302+Set-Cookie / 410 replay / authenticated /api read exercised via static harness; verified twice (evidence 2, 15) and by lore verify. | task-skill-implement-f5a-fix-packaged-mode-session-auth-add-api (GAP-1 root-cause fix, nonce group green), task-skill-review-f5a-final-verification-and-assessment |
| AC-F5A-3 | 88 | Original fixture-only gap was flagged by assess and then closed: a dedicated task added a real packages/dashboard/dist walk + GET / + deep SPA route, with a mutation-proven load-bearing negative control; re-attested by lore verify at closure commit 702a16a. | task-skill-test-f5a-ac-f5a-3-must-grep-the-real-built-dist-not (5/5 packaged serve; fail-first proof of matcher) |
| AC-F5A-4 | 90 | Route priority integration test attested pass repeatedly (13 expect calls): JSON 404 for unknown /api/*, index.html for deep client routes, immutable hashed assets. Invariant 3 directly covered. | task-skill-implement-f5a-static-serving-nonce-endpoint-and, task-skill-review-f5a-final-verification-and-assessment (evidence 4/17) |
| AC-F5A-6 | 92 | typecheck attested pass 11 times, including an explicitly verified fresh-clone precondition (existsSync check that the generated manifest is absent) in the build/loader task. Loader owns the guarded dynamic import. | task-skill-implement-f5a-build-step-embed-manifest-and (evidence 5: typecheck with no generated module on disk) |
| AC-F5A-7 | 88 | Degradation case attested green across runs: GET / serves 200 unauthenticated while nonce endpoint answers 503 with actionable JSON. Fault is injected via a seam, so the real store-construction failure path is simulated, not exercised. | task-skill-implement-f5a-static-serving-nonce-endpoint-and |
| AC-F5A-8 | 82 | allowlist\|freshness e2e group attested pass; dev-mode allowlist asserted via LORE_DASHBOARD_DEBUG_ALLOWLIST seam (no 5173 literal) and packaged allowlist is api-origin-only in the shown diff. Freshness digest check is inside omitted test files, so the stale-bundle oracle is unverifiable here. | task-skill-implement-f5a-lore-dashboard-packaged-mode-default, task-skill-review-f5a-final-verification-and-assessment (evidence 7/20) |
| AC-F5A-5 | 80 | Ambient-state defect was caught and fixed at root cause via LORE_DASHBOARD_ASSETS_FIXTURE=0 seam, verified with the module both present and absent (both exit 0). Cost recorded in the plan: the production availability path is no longer exercised by this case. | task-skill-test-f5a-source-run-guard-test-must-control-its-own (run both ways, both exit 0) |

## Gaps

- Invariant 6 ('all existing test suites stay green') was not met literally: the full two-runner suite recorded 7 failures. Attribution to a concurrent session's skill rename (commit 01a383a) is argued with a reproducible git-log command and the fact both files were mid-fix in the main checkout — credible, but the plan closed on an accepted exception rather than a green run. No post-fix green re-run is evidenced.
- GAP-1 — packaged mode minted sessions against a 'dashboard-local' api_keys owner row that packaged startup deliberately never created, so SessionStore.resolve()'s INNER JOIN returned null and every /api read 401'd. The feature was non-functional end-to-end through three archived tasks and was caught only by the Phase 4 e2e harness, meaning the earlier per-task green oracles were not load-bearing for the user-visible outcome.
- The source-run guard's precondition is now forced by LORE_DASHBOARD_ASSETS_FIXTURE=0, which short-circuits resolveAssets() before the real loader runs. This makes the test deterministic (the correct fix for the ambient-state defect) but means no test drives the guard through the genuine loader-unavailable path. Recorded as an accepted minor in the plan's Decisions Log.
- Auth-store degradation is proven with an injected construction fault rather than a real machine-auth store failure, so the 503/200 split is verified against the seam's behavior, not the production failure mode.
- The reviewed diff contains substantial changes outside the F5a plan's declared scope — SPEC-103 tiered review (config.ts review section, types.ts ledger sub-types, approve/pending/review commands), SPEC-104 worktree actor derivation (claim.ts, cli CLAUDE.md), SPEC-102 trace-stats — none of which appear in this plan's phases, tasks, or invariants. If co-landed on the same branch, the F5a evidence runs cannot isolate F5a's own regression surface.
- Attested evidence ratio 0.50. Tasks 01KYMBCZPG97AT27FWYCSRW8JZ (real-dist grep), 01KYM9Z9YBVB2WKMP1B28BAC7F (auth fix), 01KYM0WEAP841TKBJAWT8RXQPG (e2e harness), 01KYM85TMP29JPQS6QG6C72K32 (sigterm), 01KYM0WEQDDXPK071HBT648F9Q (docs) each carry zero attested entries — their results rest on self-report, including the mutation/fail-first proof that closes AC-F5A-3's oracle gap.

## Recommendations

- Schedule a follow-up full two-runner run on a clean tree at a named commit after the concurrent skill-rename repair lands, and record it as attested evidence so Invariant 6 closes on a green rather than an attributed exception.
- Add a test that constructs the dashboard-assets loader pointed at a genuinely non-existent generated module (via the existing modulePath seam, no env short-circuit) and asserts {available:false, reason} — restoring production-path coverage that the AC-F5A-5 env seam displaced.
- Order artifact chains so the end-to-end harness (or a minimal one-command smoke) runs before the mid-chain implementation tasks archive, instead of only in Phase 4.
- Require attested (exit-code-decided) evidence for any task whose result closes an oracle-quality gap — notably the AC-F5A-3 real-dist scan and its mutation proof, which are currently self-reported only.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 71635ms
- Retried: false
- Truncated sections: diff:.gitignore, diff:CLAUDE.md, diff:assets/skills/lore-kickoff/SKILL.md, diff:assets/skills/lore-product-benchmark/SKILL.md, diff:assets/skills/lore-product-benchmark/references/example-feature-matrix.md, diff:assets/skills/lore-product-lens/SKILL.md, diff:assets/skills/lore-product-lens/references/competitive-lens.md, diff:assets/skills/lore-product-to-prd/SKILL.md, diff:assets/skills/lore-product/SKILL.md, diff:assets/skills/lore-product/references/example-ost.md, diff:assets/skills/lore-product/references/example-validation-ledger.md, diff:assets/skills/lore-product/references/interview-protocol.md, diff:assets/skills/lore-product/references/mode-decompose.md, diff:assets/skills/lore-product/references/mode-discovery.md, diff:assets/skills/lore-product/references/mode-ideation.md, diff:assets/skills/lore-product/references/mode-opportunity.md, diff:assets/skills/lore-product/references/mode-prd.md, diff:assets/skills/lore-product/references/mode-ux-research.md, diff:assets/skills/lore-product/references/mode-validate.md, diff:assets/skills/lore-product/references/prd-guide.md, diff:packages/dashboard/CLAUDE.md, diff:packages/dashboard/package.json, diff:packages/dashboard/tests/e2e/global-setup-static.ts, diff:packages/dashboard/tests/e2e/playwright.static.config.ts, diff:packages/dashboard/tests/e2e/static-serving.static.ts, diff:packages/lore/src/adapters/cli/utils.ts, diff:packages/lore/src/adapters/http/CLAUDE.md, diff:packages/lore/src/adapters/http/auth.ts, diff:packages/lore/src/adapters/http/dashboard-assets-loader.ts, diff:packages/lore/src/adapters/http/index.ts, diff:packages/lore/src/adapters/http/static-serving.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/ai-provider-service.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/review-service.ts, diff:packages/lore/src/service/trace-stats-service.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli-feed-task-start.bun.test.ts, diff:packages/lore/tests/integration/cli/dashboard-sigterm.bun.test.ts, diff:packages/lore/tests/integration/cli/review.test.ts, diff:packages/lore/tests/integration/cli/tiered-review-gate.bun.test.ts, diff:packages/lore/tests/integration/cli/trace-stats.bun.test.ts, diff:packages/lore/tests/integration/dashboard-command.bun.test.ts, diff:packages/lore/tests/integration/gate-enforcer-service-layer.bun.test.ts, diff:packages/lore/tests/integration/gate-hooks.bun.test.ts, diff:packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts, diff:packages/lore/tests/integration/gate-spec-promote.bun.test.ts, diff:packages/lore/tests/integration/p2-e2e-closed-loop.bun.test.ts, diff:packages/lore/tests/integration/static-serving.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-handoff.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli-utils.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/cli/actor-session-tier.test.ts, diff:packages/lore/tests/unit/cli/actor-worktree-derivation.bun.test.ts, diff:packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/review-service.test.ts, diff:packages/lore/tests/unit/service/tiered-review.test.ts, diff:packages/lore/tests/unit/service/trace-stats-service.test.ts, diff:scripts/build.ts, diff:scripts/changed-tests.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.72 | evidence | All 8 ACs attested pass by lore verify at two named commits, incl. re-attestation after the AC-F5A-3 real-dist fix. Residual: seam-forced preconditions on AC-5/AC-7 weaken production-path coverage. |
| evidence_integrity | 78 | 0.68 | evidence | Attested lore verify runs on clean worktrees at named commits, exit-code-decided; fail-first mutation proof for AC-3. But ratio is 0.50 and several tasks are wholly self-reported; suite verdict is an… |
| scope_fidelity | 72 | low | absence | F5a files match the plan's declared anchors, but the provided diff also carries unrelated SPEC-102/103/104 work with no plan attribution; cannot confirm from these materials whether it co-landed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | Invariant 6 ('all existing test suites stay green') was not met literally: the full two-runner suite recorded 7 failures. Attribution to a concurrent session's skill rename (commit 01a383a) is argued with a reproducible git-log command and the fact both files were mid-fix in the main checkout — credible, but the plan closed on an accepted exception rather than a green run. No post-fix green re-run is evidenced. |
| outcome | major | AC-F5A-2 | GAP-1 — packaged mode minted sessions against a 'dashboard-local' api_keys owner row that packaged startup deliberately never created, so SessionStore.resolve()'s INNER JOIN returned null and every /api read 401'd. The feature was non-functional end-to-end through three archived tasks and was caught only by the Phase 4 e2e harness, meaning the earlier per-task green oracles were not load-bearing for the user-visible outcome. |
| outcome | minor | AC-F5A-5 | The source-run guard's precondition is now forced by LORE_DASHBOARD_ASSETS_FIXTURE=0, which short-circuits resolveAssets() before the real loader runs. This makes the test deterministic (the correct fix for the ambient-state defect) but means no test drives the guard through the genuine loader-unavailable path. Recorded as an accepted minor in the plan's Decisions Log. |
| outcome | minor | AC-F5A-7 | Auth-store degradation is proven with an injected construction fault rather than a real machine-auth store failure, so the 503/200 split is verified against the seam's behavior, not the production failure mode. |
| scope_fidelity | minor | — | The reviewed diff contains substantial changes outside the F5a plan's declared scope — SPEC-103 tiered review (config.ts review section, types.ts ledger sub-types, approve/pending/review commands), SPEC-104 worktree actor derivation (claim.ts, cli CLAUDE.md), SPEC-102 trace-stats — none of which appear in this plan's phases, tasks, or invariants. If co-landed on the same branch, the F5a evidence runs cannot isolate F5a's own regression surface. |
| evidence_integrity | minor | — | Attested evidence ratio 0.50. Tasks 01KYMBCZPG97AT27FWYCSRW8JZ (real-dist grep), 01KYM9Z9YBVB2WKMP1B28BAC7F (auth fix), 01KYM0WEAP841TKBJAWT8RXQPG (e2e harness), 01KYM85TMP29JPQS6QG6C72K32 (sigterm), 01KYM0WEQDDXPK071HBT648F9Q (docs) each carry zero attested entries — their results rest on self-report, including the mutation/fail-first proof that closes AC-F5A-3's oracle gap. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Schedule a follow-up full two-runner run on a clean tree at a named commit after the concurrent skill-rename repair lands, and record it as attested evidence so Invariant 6 closes on a green rather than an attributed exception. | The current closure rests on attribution reasoning; a green run is cheap and removes the only outstanding suite-level doubt. |
| plan | Add a test that constructs the dashboard-assets loader pointed at a genuinely non-existent generated module (via the existing modulePath seam, no env short-circuit) and asserts {available:false, reason} — restoring production-path coverage that the AC-F5A-5 env seam displaced. | Plan already records this as an accepted residual; it is a small, non-flaky test that closes the gap. |
| process | Order artifact chains so the end-to-end harness (or a minimal one-command smoke) runs before the mid-chain implementation tasks archive, instead of only in Phase 4. | GAP-1 rendered the shipped feature non-functional yet passed every earlier task's oracle; only the e2e harness detected it. |
| process | Require attested (exit-code-decided) evidence for any task whose result closes an oracle-quality gap — notably the AC-F5A-3 real-dist scan and its mutation proof, which are currently self-reported only. | Self-reported evidence is what the AC-F5A-3 fixture gap and the AC-F5A-5 ambient-state defect both slipped through. |

## Unverifiable Materials

- packages/dashboard/tests/e2e/static-serving.static.ts, playwright.static.config.ts, global-setup-static.ts: Omitted from the diff; the freshness-digest oracle (AC-F5A-8 stale-bundle-is-a-failure clause) and the real-dist secret-free scan cannot be inspected, only read from evidence text.
- packages/lore/src/adapters/http/static-serving.ts and dashboard-assets-loader.ts: Omitted from the diff; dispatch order, cache headers, nonce TTL/single-use semantics and the loader's guarded dynamic import are asserted only through test output.
- scripts/build.ts dashboard step and .gitignore entry: Omitted; the digest short-circuit, manifest generation, and Invariant 2 (generated module git-ignored, single importer) are inferred from build log excerpts, not read.
- Attribution of the co-landed SPEC-102/103/104 changes to this branch: The diff shows them but the plan never mentions them; cannot determine from these materials whether they are F5a-branch drift or unrelated tree state.
- A green full two-runner suite run: The only full-suite evidence entry (task 01KYM0WF49F7ZB4NS1TG54Y7SG, evidence 11) is result=fail with 7 failures argued foreign; no subsequent green run exists in the bundle.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 13 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.50
