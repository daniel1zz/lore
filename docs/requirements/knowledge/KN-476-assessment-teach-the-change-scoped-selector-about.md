---
id: KN-476
type: knowledge
role: knowledge
title: "Assessment: Teach the change-scoped selector about hooks/ and assets/, so a hook edit can no longer silence the two tests that prove pre-push is wired (2026-08-19)"
status: archived
priority: medium
created: 2026-08-19
updated: 2026-10-23
tags: []
parent: PLAN-130
links:
  - {id: PLAN-130, type: informs}
---
# Assessment: partially_met (58/100)

Scope: plan `01M0AMKKMR8WNVAXYNK1B27TV8`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TC-1 | 35 | No oracle run recorded (0 pass/0 fail). The declared vitest command over packages/lore/tests/unit/scripts/changed-tests-selector.test.ts was never executed in this bundle, and the diff changes selector internals (new TreeScanScope member) that suite covers. | 01M0AMM60446Y7AW0QCQRDGVTP (no AC-TC-1 evidence record) |
| AC-TC-2 | 65 | No evidence record filed for AC-TC-2's own command, but green tails [4][5] show its two named HAPPY cases ('AC-TC-2 > HAPPY: exits 0 ...', reason-tag case) passing inside the same file run from repo root. Indirect, not the declared cd-into-package invocation. | 01M0AMM60446Y7AW0QCQRDGVTP (AC-TC-2 cases visible in AC-TC-4 pass tails) |
| AC-TC-3 | 35 | No typecheck run recorded. The diff widens the exported TreeScanScope union in scripts/changed-tests.ts, which is exactly the change class that can break exhaustive switches in other consumers; unverified here. | 01M0AMM60446Y7AW0QCQRDGVTP (no tsc oracle) |
| AC-TC-4 | 80 | 2 attested passes plus red baseline and two single-site reverts; oracle drives the shipped CLI as required, and both named code sites changed. Deducted: green is proven only against synthetic stand-ins at the real paths, so production selection of the REAL guard suites is asserted in prose, not mea… | 01M0AMM60446Y7AW0QCQRDGVTP (evidence [4][5] attested pass), 01M0AMM60446Y7AW0QCQRDGVTP (evidence [1][2][3] red-first + per-site reverts (self-reported)) |

## Gaps

- In scripts/changed-tests.ts, classifyTreeScanningOracle tests HOOK_OR_ASSET_PAIR_MARKER_RE before BARE_MAIN_INVOCATION_RE and returns immediately. Any test file that is a genuine repo-tracked-text-source or packages-test-tree oracle but also mentions the literal 'hooks/pre-push' (the diff itself notes hasTextSourceExtension's doc comment uses that exact worked example) is narrowed to hooks-and-assets-pair and stops being selected for the changes it previously guarded. No oracle covers this regr…
- The AC-TC-4 suite in packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts writes its own stand-in contents at the guard paths in a temp repo, so it proves the selector recognizes the marker in fixture text. It never asserts that packages/lore/tests/unit/assets/pre-push-parity.test.ts and packages/lore/tests/integration/pre-push-trip.bun.test.ts actually contain the literals. If a real guard file is reformatted, production selection silently reverts to the false green the AC exists to …
- AC-TC-3 (bun run typecheck exits 0) has no evidence record, yet the diff widens the exported TreeScanScope union in scripts/changed-tests.ts to a third member. Any exhaustive switch or mapped type over that union in another package or script would now fail typecheck, and nothing in this bundle rules that out.
- AC-TC-1 requires >=6 selector unit cases passing over packages/lore/tests/unit/scripts/changed-tests-selector.test.ts. No run of that suite appears in the bundle, and the diff altered the classification path that suite exercises.
- Evidence [1], [2] and [3] — the pre-fix red baseline and the two single-site reverts that constitute AC-TC-4's explicit 'neither alone is sufficient' requirement — are self-reported, not attested (attested 2 of 5, ratio 0.40). The strongest quality claim in this bundle rests on unattested output tails.
- AC-TC-2's declared command runs from packages/lore; the only observed passes come from a repo-root bun test invocation of the same file inside the AC-TC-4 evidence. Working-directory-sensitive behavior in a selector that resolves repo-relative paths makes that substitution non-trivial, and no record covers the declared form.
- The plan bans the literal-path-marker approach. The implementation adds HOOK_OR_ASSET_PAIR_MARKER_RE, a literal-path grep, in scripts/changed-tests.ts. It is defensible — it reuses literals already in the guard files and pairs them with both predicate widenings, and the code documents exactly why the earlier attempt was inert — but it lands adjacent to the prohibited approach and inherits its fragility to any edit that drops the literal.

## Recommendations

- Declare an explicit ac_scope when a plan targets a single AC, or require the untargeted ACs' oracles to be re-run because the diff touches shared code they cover.
- Require attestation for red-first and falsifying-revert runs, not only for the final green. An unattested revert proof cannot discharge a 'neither site alone is sufficient' criterion.
- Add a criterion that the real guard suites must match the selector's membership marker, so the content-marker dependency is pinned on both sides rather than only inside a synthetic fixture.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 124939ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-TC-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.7 | evidence | AC-TC-4 delivered and driven through the shipped CLI with both named sites changed; AC-TC-1/AC-TC-3 unexercised, and the guard selection is proven on fixtures not the real suites. |
| evidence_integrity | 68 | 0.75 | evidence | Greens attested and coherent, red baseline plus two isolating reverts described; but the entire neither-alone-suffices proof is self-reported, and 3 of 4 ACs have no run. |
| scope_fidelity | 80 | 0.65 | evidence | Diff limited to the two intended sites plus its own test file; no edits to the parity-pinned hook copies or attestation-completeness. Content-marker matching sits close to the banned literal-marker a… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TC-4 | In scripts/changed-tests.ts, classifyTreeScanningOracle tests HOOK_OR_ASSET_PAIR_MARKER_RE before BARE_MAIN_INVOCATION_RE and returns immediately. Any test file that is a genuine repo-tracked-text-source or packages-test-tree oracle but also mentions the literal 'hooks/pre-push' (the diff itself notes hasTextSourceExtension's doc comment uses that exact worked example) is narrowed to hooks-and-assets-pair and stops being selected for the changes it previously guarded. No oracle covers this regr… |
| outcome | major | AC-TC-4 | The AC-TC-4 suite in packages/lore/tests/unit/scripts/changed-tests-cli.bun.test.ts writes its own stand-in contents at the guard paths in a temp repo, so it proves the selector recognizes the marker in fixture text. It never asserts that packages/lore/tests/unit/assets/pre-push-parity.test.ts and packages/lore/tests/integration/pre-push-trip.bun.test.ts actually contain the literals. If a real guard file is reformatted, production selection silently reverts to the false green the AC exists to … |
| outcome | major | AC-TC-3 | AC-TC-3 (bun run typecheck exits 0) has no evidence record, yet the diff widens the exported TreeScanScope union in scripts/changed-tests.ts to a third member. Any exhaustive switch or mapped type over that union in another package or script would now fail typecheck, and nothing in this bundle rules that out. |
| outcome | major | AC-TC-1 | AC-TC-1 requires >=6 selector unit cases passing over packages/lore/tests/unit/scripts/changed-tests-selector.test.ts. No run of that suite appears in the bundle, and the diff altered the classification path that suite exercises. |
| evidence_integrity | major | AC-TC-4 | Evidence [1], [2] and [3] — the pre-fix red baseline and the two single-site reverts that constitute AC-TC-4's explicit 'neither alone is sufficient' requirement — are self-reported, not attested (attested 2 of 5, ratio 0.40). The strongest quality claim in this bundle rests on unattested output tails. |
| evidence_integrity | minor | AC-TC-2 | AC-TC-2's declared command runs from packages/lore; the only observed passes come from a repo-root bun test invocation of the same file inside the AC-TC-4 evidence. Working-directory-sensitive behavior in a selector that resolves repo-relative paths makes that substitution non-trivial, and no record covers the declared form. |
| scope_fidelity | minor | AC-TC-4 | The plan bans the literal-path-marker approach. The implementation adds HOOK_OR_ASSET_PAIR_MARKER_RE, a literal-path grep, in scripts/changed-tests.ts. It is defensible — it reuses literals already in the guard files and pairs them with both predicate widenings, and the code documents exactly why the earlier attempt was inert — but it lands adjacent to the prohibited approach and inherits its fragility to any edit that drops the literal. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Declare an explicit ac_scope when a plan targets a single AC, or require the untargeted ACs' oracles to be re-run because the diff touches shared code they cover. | Three of four in-scope ACs ended with zero runs while the diff changed code all three exercise. |
| process | Require attestation for red-first and falsifying-revert runs, not only for the final green. An unattested revert proof cannot discharge a 'neither site alone is sufficient' criterion. | Evidence [1][2][3] carry the entire two-sites-load-bearing argument and are all self-reported. |
| spec | Add a criterion that the real guard suites must match the selector's membership marker, so the content-marker dependency is pinned on both sides rather than only inside a synthetic fixture. | Content-marker coupling that only fixtures assert can silently decay when the real files are reformatted. |

## Unverifiable Materials

- Presence of the hooks/pre-push and assets/project/pre-push literals in the two real guard suites: Asserted in code comments and fixture doc comments as grep-verified, but no oracle run or file content is in these materials.
- Absence of any other test file matching HOOK_OR_ASSET_PAIR_MARKER_RE that also qualifies for a wider scope: The 'none do today' claim is comment prose; the repo's other test files are not in these materials.
- bun run typecheck result and the AC-TC-1 selector unit suite result: No evidence records exist for either; both are 0 pass / 0 fail in the deterministic facts.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 8
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.40
