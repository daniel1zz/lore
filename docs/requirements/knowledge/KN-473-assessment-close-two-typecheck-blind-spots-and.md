---
id: KN-473
type: knowledge
role: knowledge
title: "Assessment: Close two typecheck blind spots and correct the stale comments that understate them (2026-08-18)"
status: approved
priority: medium
created: 2026-08-18
updated: 2026-08-18
tags: []
parent: PLAN-077
links:
  - {id: PLAN-077, type: informs}
---
# Assessment: met (87/100)

Scope: plan `01KZN4F83SHEP9FT8A5YBZRTX5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TC-1 | 92 | Checked-in scripts/tests/typecheck-chain-contract.test.ts asserts both chain membership (whole-token matcher, plus that the script invokes tsc on tsconfig.e2e.json) and a live --listFilesOnly floor of >=27. Both required reds recorded with real output tails; 4 passes, 2 attested. Reds are self-repo… | 01KZN60K8EA3VJ07PYAY8YY6QN (reds (a) chain-removal → false, (b) include→zero files → 0>=27; attested greens), 01KZN4F8ARA3RA6MJBVJFRS8XZ (tsc_exit=0 resolved_e2e_file_count=27) |
| AC-TC-2 | 78 | Diff replaces the stale 'those two helper' phrasing with the measured 27-file census and points at tsconfig.e2e.json; 4 passes incl. an attested red (phrase re-inserted → exit 1). Oracle only asserts ABSENCE of the stale phrase, never PRESENCE of the measured count — deleting the comment entirely w… | 01KZN60K8EA3VJ07PYAY8YY6QN ([14] attested-red exit 1; [3] probe red; [5]/[10] greens) |
| AC-TC-3 | 88 | Script now runs prebuild before tsc; contract test moves routeTree.gen.ts aside, asserts zero TS2345/7006/2307 and byte-identical restore, with a ready-made red (expected 24 to be 0) and attested greens. Follow-up made the on-disk backup load-bearing and fixed the stale durability comment. | 01KZN4F8ARA3RA6MJBVJFRS8XZ ([3] pre-fix red 24 errors; [4]/[9] greens), 01KZN60K8EA3VJ07PYAY8YY6QN ([6]/[11] greens; backup read-back + unused `result` corrected in diff) |

## Gaps

- The AC-TC-2 oracle asserts only that the phrase 'those two helper' is absent from packages/dashboard/tsconfig.tests.json. It never asserts the corrected text is present, so deleting the residual comment wholesale — the same class of vacuous-green the spec warns about — would keep it green while the greppable measured count disappeared.
- Both AC-TC-1 reds (chain-removal and zero-e2e-file include) are self-reported expected-fail rows; attested_fail is 0 for this AC. Given AC-TC-1 was re-baselined precisely because the previous oracle was structurally blind, the chain-membership red deserves attestation.
- typecheck:dashboard-tests in package.json now depends on `bun --cwd=packages/dashboard run prebuild`, but that script's definition is outside the diff, so its idempotency and equivalence to `router-cli generate` (asserted in the test header) cannot be confirmed from the materials.
- scripts/tests/typecheck-script-contract.test.ts renames the real packages/dashboard/src/routeTree.gen.ts aside for up to ~120s. Nothing guards against a concurrent vitest worker or a parallel `bun run typecheck` observing the missing file, which would surface as an unrelated flaky failure.

## Recommendations

- Strengthen AC-TC-2's verify command to a two-sided check: stale phrase count == 0 AND the corrected measured-count token present in packages/dashboard/tsconfig.tests.json.
- Require attested falsifier runs for reds that target the specific blind spot an AC was re-baselined to cover, not just self-reported expected-fail rows.
- When a contract test mutates a tracked/generated repo file, require a lock or a serialized test-file annotation so parallel runners cannot observe the mutated window.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 64365ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-TC-1, AC-TC-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.8 | evidence | Both blind spots closed in-diff: new tsconfig.e2e.json wired into the chain, prebuild prerequisite made explicit, stale comment corrected; each backed by a real red and greens. |
| evidence_integrity | 80 | 0.72 | evidence | All three ACs have 2 attested passes and demonstrated reds with plausible tails, but attested ratio is 0.29 and the pivotal AC-TC-1 reds are self-reported. |
| scope_fidelity | 95 | 0.85 | evidence | Diff limited to root package.json, the two dashboard tsconfigs, and the two contract tests — exactly the plan's C1/C2 plus the assess follow-ups. No drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-TC-2 | The AC-TC-2 oracle asserts only that the phrase 'those two helper' is absent from packages/dashboard/tsconfig.tests.json. It never asserts the corrected text is present, so deleting the residual comment wholesale — the same class of vacuous-green the spec warns about — would keep it green while the greppable measured count disappeared. |
| evidence_integrity | minor | AC-TC-1 | Both AC-TC-1 reds (chain-removal and zero-e2e-file include) are self-reported expected-fail rows; attested_fail is 0 for this AC. Given AC-TC-1 was re-baselined precisely because the previous oracle was structurally blind, the chain-membership red deserves attestation. |
| outcome | minor | AC-TC-3 | typecheck:dashboard-tests in package.json now depends on `bun --cwd=packages/dashboard run prebuild`, but that script's definition is outside the diff, so its idempotency and equivalence to `router-cli generate` (asserted in the test header) cannot be confirmed from the materials. |
| outcome | minor | AC-TC-3 | scripts/tests/typecheck-script-contract.test.ts renames the real packages/dashboard/src/routeTree.gen.ts aside for up to ~120s. Nothing guards against a concurrent vitest worker or a parallel `bun run typecheck` observing the missing file, which would surface as an unrelated flaky failure. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Strengthen AC-TC-2's verify command to a two-sided check: stale phrase count == 0 AND the corrected measured-count token present in packages/dashboard/tsconfig.tests.json. | Absence-only greps stay green when the asserted text is deleted, the exact vacuity mode this spec was re-baselined to eliminate. |
| process | Require attested falsifier runs for reds that target the specific blind spot an AC was re-baselined to cover, not just self-reported expected-fail rows. | Attested ratio here is 0.29 and the pivotal chain-membership red is self-reported. |
| plan | When a contract test mutates a tracked/generated repo file, require a lock or a serialized test-file annotation so parallel runners cannot observe the mutated window. | Prevents cross-test flakes from the routeTree.gen.ts move-aside window. |

## Unverifiable Materials

- packages/dashboard/package.json `prebuild` script body: Not in the diff; the test header's claim that it is router-cli generate and deterministically idempotent cannot be checked.
- Actual file census under packages/dashboard/tests/e2e: The 27 count is only reported via oracle output; the tree itself is not in the materials.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.29
