---
id: KN-389
type: knowledge
role: knowledge
title: "Assessment: Implementation — context verb family (two-zone CLAUDE.md, admission checks, skill retirement) (2026-07-27)"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-088
links:
  - {id: PLAN-088, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01KYH98GVKM0C7KE0NVM1W45TS`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CTX-1 | 92 | Close-out attested run of the exact AC command: 16/16 pass, 1 file matched. Earlier RED-phase failure is expected TDD sequencing. Test file body truncated, so five-state/idempotency/Z2 coverage is asserted by test names only, not inspected. | 01KYH9ARX8Q2D11HP65RGAC3D4 (evidence[1] attested pass, 16 tests), 01KYH9ANZ5EK6PYEM0PMW3YSXG |
| AC-CTX-2 | 90 | Exact AC command attested pass at close-out (15 tests) plus at the implement task. RED run recorded 14 failed/1 passed beforehand, a credible TDD trail. claude-md-check.ts and the suite body are truncated, so advisory-never-exit-affecting is unverified in source. | 01KYH9ARX8Q2D11HP65RGAC3D4 (evidence[2]), 01KYH9AN41YW77RZ7HVTV840EA |
| AC-CTX-3 | 84 | Compiled-binary e2e attested pass at close-out; CLI command source visible and matches D3 (exit 0 + stderr warning + skeleton). Output tail shows only 2 of N cases; idempotency and diverged_skip cases are not visible in any tail. Suite body truncated. | 01KYH9ARX8Q2D11HP65RGAC3D4 (evidence[3] attested pass), 01KYH9APSHPKHY811BBBYV5XP7 |
| AC-CTX-4 | 74 | SSOT pin attested pass (6 tests) and the diff shows setup-project-flow genuinely delegating to spliceManagedSections. But the refactor task itself recorded setup-project-claudemd.test.ts and setup-user-once-marker as FAIL; only the later full-suite run covers 'existing setup suite stays green' — no… | 01KYH9AQM9G0ARJZGA5ARFHPNA (evidence[3],[4] fail), 01KYH9ARX8Q2D11HP65RGAC3D4 (evidence[4],[7]) |
| AC-CTX-5 | 80 | Hook-trip e2e attested pass at close-out; registration wiring visible in distribution-hooks.ts/manifest/assets-ssot. assets/hooks/claude-md-guard.sh is truncated, so fail-open and zero-numeric-literals are only witnessed via test names; the visible tail still carries stale 'RED today' descriptions. | 01KYH9ARX8Q2D11HP65RGAC3D4 (evidence[5]), 01KYH9ARG0BD96GJ636RKHDFD0 |
| AC-CTX-6 | 80 | Retirement e2e + manifest --check OK (294 files) attested at close-out; RETIRED_FROM_INSTALL_PATHS and the install-time empty-dir sweep are visible in the diff. Source comments contradict each other on whether the skill asset was deleted from assets/ (see gaps). | 01KYH9ARX8Q2D11HP65RGAC3D4 (evidence[6]), 01KYH9ARG0BD96GJ636RKHDFD0 |
| AC-CTX-7 | 92 | `bun run typecheck && bun run test` attested pass on main at close-out with output tail, plus two earlier attested full-gate passes. Tail is truncated to unrelated suites, so no aggregate pass/fail summary line is visible. | 01KYH9ARX8Q2D11HP65RGAC3D4 (evidence[7]) |

## Gaps

- The splice-SSOT implement task recorded setup-project-claudemd.test.ts and setup-user-once-marker.bun.test.ts as result=fail and never recorded a scoped green re-run. AC-CTX-4's 'existing setup e2e suite stays green' clause therefore rests only on the aggregate `bun run test` pass, which cannot be attributed to those specific suites from these materials.
- setup-project-flow.ts documents that a CLAUDE.md zone wrapped by a pre-refactor lore build (no fingerprint comment) now returns VALIDATION_ERROR, surfaced as claude_md step 'failed'. No AC, test, or evidence record covers this upgrade path, and service/CLAUDE.md simultaneously claims 'legacy fingerprint-less zone adoption' — the two docs disagree on the shipped behavior.
- Three RED test tasks recorded oracle=manual with result=pass for runs described in the command string as 'RED expected'. A pass verdict on an intentionally-failing run makes the recorded result uninformative; only one (the admission suite) embedded actual counts (14 failed | 1 passed).
- All 12 tasks are status=draft, and the close-out's lore verify entry is a prose summary string rather than a reproducible command. Code-anchor declaration and `lore status --check-tree --check-drift` clean are claimed in the objective with no corresponding evidence record.
- real-asset-source.ts states the retired skill's source file was deleted from assets/skills/ entirely, but assets-ssot.test.ts still declares skills/lore-init-context/SKILL.md and the embedded manifest diff shows no removal of that entry. One of the two comments is factually wrong in shipped code.
- The guard-hook integration suite's visible output still carries authoring-time descriptions ('RED today: the paired implement task has not landed it yet') on tests that now pass, which will mislead the next reader of a failing run.

## Recommendations

- Add a follow-up task that re-runs setup-project-claudemd.test.ts and setup-user-once-marker.bun.test.ts as attested scoped oracles, and attach them to AC-CTX-4 so the 'stays green' clause has direct evidence.
- Decide and pin one behavior for a pre-refactor, fingerprint-less marker-wrapped CLAUDE.md (adopt-and-fingerprint vs fail-loud), add an AC for it, and fix whichever of setup-project-flow.ts / service/CLAUDE.md contradicts the decision.
- Require RED-phase evidence to record the failing run's result verbatim (counts or non-zero exit) instead of oracle=manual result=pass, and require tasks to leave draft before close-out verify.
- Sweep authoring-time 'RED today / target behavior' strings out of describe/it names once the paired implement task lands, as part of the implement task's own checklist.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 92438ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/hooks/claude-md-guard.sh, diff:packages/lore/src/service/claude-md-check.ts, diff:packages/lore/src/service/context-facts.ts, diff:packages/lore/src/service/context-projection.ts, diff:packages/lore/tests/e2e/context-verbs-compiled.bun.test.ts, diff:packages/lore/tests/integration/claude-md-guard-hook-trip.bun.test.ts, diff:packages/lore/tests/integration/init-context-skill-retirement.bun.test.ts, diff:packages/lore/tests/integration/setup-user-once-marker.bun.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/flows/context-flow.test.ts, diff:packages/lore/tests/unit/flows/setup-project-claudemd.test.ts, diff:packages/lore/tests/unit/flows/setup-splice-ssot.test.ts, diff:packages/lore/tests/unit/service/claude-md-admission.test.ts, diff:packages/lore/tests/unit/service/context-facts.test.ts, diff:packages/lore/tests/unit/service/context-projection.test.ts
- Reasoning clipped for: AC-CTX-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.72 | evidence | All 7 AC commands pass at close-out with output tails; visible diff matches the spec's D-decisions. Deducted for an unevidenced upgrade path on pre-refactor marker-wrapped CLAUDE.md files. |
| evidence_integrity | 78 | 0.65 | evidence | Close-out attests all 7 AC commands, and RED->GREEN ordering is visible. Weakened by 0.43 attested ratio, oracle=manual 'pass' on RED runs, and two never-re-run fails on AC-CTX-4. |
| scope_fidelity | 86 | 0.7 | evidence | Changes map to D1-D11 with no unexplained files. Minor drift: an install-time empty-dir sweep in setup-service and a fingerprint-format change to installed CLAUDE.md, both self-declared. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-CTX-4 | The splice-SSOT implement task recorded setup-project-claudemd.test.ts and setup-user-once-marker.bun.test.ts as result=fail and never recorded a scoped green re-run. AC-CTX-4's 'existing setup e2e suite stays green' clause therefore rests only on the aggregate `bun run test` pass, which cannot be attributed to those specific suites from these materials. |
| outcome | major | — | setup-project-flow.ts documents that a CLAUDE.md zone wrapped by a pre-refactor lore build (no fingerprint comment) now returns VALIDATION_ERROR, surfaced as claude_md step 'failed'. No AC, test, or evidence record covers this upgrade path, and service/CLAUDE.md simultaneously claims 'legacy fingerprint-less zone adoption' — the two docs disagree on the shipped behavior. |
| evidence_integrity | minor | — | Three RED test tasks recorded oracle=manual with result=pass for runs described in the command string as 'RED expected'. A pass verdict on an intentionally-failing run makes the recorded result uninformative; only one (the admission suite) embedded actual counts (14 failed \| 1 passed). |
| evidence_integrity | minor | — | All 12 tasks are status=draft, and the close-out's lore verify entry is a prose summary string rather than a reproducible command. Code-anchor declaration and `lore status --check-tree --check-drift` clean are claimed in the objective with no corresponding evidence record. |
| scope_fidelity | minor | AC-CTX-6 | real-asset-source.ts states the retired skill's source file was deleted from assets/skills/ entirely, but assets-ssot.test.ts still declares skills/lore-init-context/SKILL.md and the embedded manifest diff shows no removal of that entry. One of the two comments is factually wrong in shipped code. |
| outcome | minor | — | The guard-hook integration suite's visible output still carries authoring-time descriptions ('RED today: the paired implement task has not landed it yet') on tests that now pass, which will mislead the next reader of a failing run. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a follow-up task that re-runs setup-project-claudemd.test.ts and setup-user-once-marker.bun.test.ts as attested scoped oracles, and attach them to AC-CTX-4 so the 'stays green' clause has direct evidence. | Two recorded fails on those exact suites are the only per-suite signal in the bundle. |
| spec | Decide and pin one behavior for a pre-refactor, fingerprint-less marker-wrapped CLAUDE.md (adopt-and-fingerprint vs fail-loud), add an AC for it, and fix whichever of setup-project-flow.ts / service/CLAUDE.md contradicts the decision. | Shipped docs disagree; the path affects every repo with an existing lore install. |
| process | Require RED-phase evidence to record the failing run's result verbatim (counts or non-zero exit) instead of oracle=manual result=pass, and require tasks to leave draft before close-out verify. | attested ratio 0.43 with pass-labelled RED runs makes the TDD trail hard to audit. |
| process | Sweep authoring-time 'RED today / target behavior' strings out of describe/it names once the paired implement task lands, as part of the implement task's own checklist. | Stale RED labels persist in shipped, passing suites (AC-CTX-3, AC-CTX-5 tails). |

## Unverifiable Materials

- packages/lore/src/service/context-projection.ts: Truncated from the diff. Fingerprint hashing, five-state transitions, Z2 byte-preservation, and legacy-zone handling — the core of AC-CTX-1 and AC-CTX-4 — could not be read.
- assets/hooks/claude-md-guard.sh: Truncated. Fail-open behavior and the 'zero numeric budget literals' property for AC-CTX-5 are asserted only by test names in a partial output tail.
- packages/lore/src/service/claude-md-check.ts and context-facts.ts: Truncated. reference_missing grammar, URL-scheme exclusion, and advisory-never-exit-affecting separation (AC-CTX-2) could not be inspected.
- All 11 test files backing AC-CTX-1..6: Truncated. Assertion strength (whether the suites actually cover the AC clauses, not just share their names) is unverified; only pass counts and partial tails are available.
- Full output of `bun run typecheck && bun run test` (AC-CTX-7): Tail shows unrelated dashboard/http suites with no aggregate summary or exit-code line.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 12 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.43
