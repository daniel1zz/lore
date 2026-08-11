---
id: KN-175
type: knowledge
role: knowledge
title: "Assessment: Close two typecheck blind spots and correct the stale comments that understate them (2026-08-10)"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-077
links:
  - {id: PLAN-077, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01KZN4F83SHEP9FT8A5YBZRTX5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TC-1 | 91 | Checked-in test asserts both chain membership (whole-token regex, plus that the wired script targets tsconfig.e2e.json) and a live tsc --listFilesOnly >=27 floor with exit-code check. Both required reds recorded separately; green re-run at repo root. CONTROL case guards vacuity. | 01KZN60K8EA3VJ07PYAY8YY6QN (reds [1] chain removed, [2] include repointed -> 0 files; greens [4][9][12]), 01KZN4F8ARA3RA6MJBVJFRS8XZ (original direct-tsc oracle [1]: 27 files, exit 0) |
| AC-TC-2 | 76 | Stale phrase removed and diff shows the corrected comment stating the measured 27 (8+6+13) and naming tsconfig.e2e.json. But the oracle is absence-only (grep -c 'those two helper' == 0); deleting the whole comment would also pass. The 'states the measured count / greppable' half is unasserted. | 01KZN60K8EA3VJ07PYAY8YY6QN ([3] red with phrase re-inserted, [5][10] pass), 01KZN4F8ARA3RA6MJBVJFRS8XZ ([2][8] pass) |
| AC-TC-3 | 88 | Script now runs prebuild before tsc; test moves routeTree.gen.ts aside in a real subprocess run, asserts zero TS2345/7006/2307, accepts the fail-loud branch, restores from the on-disk backup and asserts byte-identical. Pre-fix red (expected 24 to be 0) recorded. Comment/code durability disagreement… | 01KZN4F8ARA3RA6MJBVJFRS8XZ ([3] red 24 errors, [4][9][10] pass), 01KZN60K8EA3VJ07PYAY8YY6QN ([6][11][13] pass after backup-read fix) |

## Gaps

- The AC requires the corrected text to state the measured count and remain greppable, but the oracle is purely negative (`grep -c 'those two helper' == 0`). Deleting the comment entirely — or replacing it with text that omits 27 — passes. The diff does contain the correct text, so the outcome is delivered; only the guard is one-sided.
- Deterministic facts show attested_fail=0 for all three ACs. Every red (chain edit, include repoint, stale-phrase re-insert, pre-fix 24-error run) is self-reported, and the chain test's header explicitly states the reds were observed by hand rather than reproduced automatically. Falsifiability therefore rests on unattested claims.
- AC-TC-1(b) runs `--listFilesOnly`, which resolves the program without typechecking it. Combined with the new project's relaxed settings (no rootDir, types widened to node+bun-types), the checked-in test would stay green even if `typecheck:dashboard-e2e` began emitting errors. The full-chain `bun run typecheck` pass mitigates this but is not the AC's oracle.
- The chosen fix makes a check-only script write a generated source file (`bun --cwd=packages/dashboard run prebuild`). The referenced `prebuild` script is not visible in the diff, and its idempotence is asserted only in a test comment; the observed evidence is one passing subprocess run.

## Recommendations

- Rewrite AC-TC-2's verify to include a positive check — e.g. `grep -q '27 total' packages/dashboard/tsconfig.tests.json && grep -q 'tsconfig.e2e.json' ... && test $(grep -c 'those two helper' ...) -eq 0` — so the assertion cannot be satisfied by deleting the comment.
- Require at least one attested expected-fail per AC before archiving a task, not just attested greens. Attested ratio here was 0.26 with zero attested fails.
- Add to AC-TC-1 (or a new AC) an assertion that `bun run typecheck:dashboard-e2e` exits 0 — a real typecheck, not `--listFilesOnly` resolution.
- Document in package.json (or the tsconfig header) that typecheck:dashboard-tests now regenerates src/routeTree.gen.ts, and confirm packages/dashboard's `prebuild` script is the router-cli generate step.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 65850ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-TC-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.8 | evidence | Both blind spots closed and wired: e2e project in the typecheck chain, prebuild prerequisite explicit, stale 13x comment corrected. AC-TC-2's oracle under-asserts its own positive half. |
| evidence_integrity | 76 | 0.75 | evidence | Reds recorded for all three ACs plus greens re-run at repo root and full-chain tsc; but attested ratio 0.26 and attested_fail=0 everywhere, so every falsification run is self-reported. |
| scope_fidelity | 94 | 0.85 | evidence | Diff confined to root package.json, the two dashboard tsconfigs, and two new contract tests. Existing exclude left intact as the task directed; no unexplained drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-TC-2 | The AC requires the corrected text to state the measured count and remain greppable, but the oracle is purely negative (`grep -c 'those two helper' == 0`). Deleting the comment entirely — or replacing it with text that omits 27 — passes. The diff does contain the correct text, so the outcome is delivered; only the guard is one-sided. |
| evidence_integrity | minor | AC-TC-1 | Deterministic facts show attested_fail=0 for all three ACs. Every red (chain edit, include repoint, stale-phrase re-insert, pre-fix 24-error run) is self-reported, and the chain test's header explicitly states the reds were observed by hand rather than reproduced automatically. Falsifiability therefore rests on unattested claims. |
| outcome | minor | AC-TC-1 | AC-TC-1(b) runs `--listFilesOnly`, which resolves the program without typechecking it. Combined with the new project's relaxed settings (no rootDir, types widened to node+bun-types), the checked-in test would stay green even if `typecheck:dashboard-e2e` began emitting errors. The full-chain `bun run typecheck` pass mitigates this but is not the AC's oracle. |
| outcome | minor | AC-TC-3 | The chosen fix makes a check-only script write a generated source file (`bun --cwd=packages/dashboard run prebuild`). The referenced `prebuild` script is not visible in the diff, and its idempotence is asserted only in a test comment; the observed evidence is one passing subprocess run. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Rewrite AC-TC-2's verify to include a positive check — e.g. `grep -q '27 total' packages/dashboard/tsconfig.tests.json && grep -q 'tsconfig.e2e.json' ... && test $(grep -c 'those two helper' ...) -eq 0` — so the assertion cannot be satisfied by deleting the comment. | The AC's own wording demands the corrected text state the measured count; the current oracle only proves the old phrase is gone. |
| process | Require at least one attested expected-fail per AC before archiving a task, not just attested greens. Attested ratio here was 0.26 with zero attested fails. | This spec's own cautionary case is an exit 0 that checked nothing; unattested reds cannot rule that class out. |
| spec | Add to AC-TC-1 (or a new AC) an assertion that `bun run typecheck:dashboard-e2e` exits 0 — a real typecheck, not `--listFilesOnly` resolution. | Resolution count proves coverage exists; only a real run proves the coverage is clean and will catch regressions. |
| plan | Document in package.json (or the tsconfig header) that typecheck:dashboard-tests now regenerates src/routeTree.gen.ts, and confirm packages/dashboard's `prebuild` script is the router-cli generate step. | A check command with a write side effect surprises callers and CI; the generator script itself is not visible in the reviewed diff. |

## Unverifiable Materials

- packages/dashboard/package.json `prebuild` script: Not present in the diff; that it runs router-cli generate and is idempotent is asserted only in a test comment.
- Attested backing for the four expected-fail (RED) runs: Deterministic facts report attested_fail=0 for all ACs, so the red observations are self-reported only.
- Actual contents of packages/dashboard/tests/e2e (the 8+6+13=27 census): Census taken from task notes and a tsc file count; the directory listing itself is not in the materials.

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.26
