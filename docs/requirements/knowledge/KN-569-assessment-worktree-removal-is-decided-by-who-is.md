---
id: KN-569
type: knowledge
role: knowledge
title: "Assessment: Worktree removal is decided by who is inside, not by how long it has been quiet (2026-10-12)"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-23
tags: []
parent: PLAN-156
links:
  - {id: PLAN-156, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01M4QCSJZT8BF0W1NJ1RB8HC5D`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WL-1 | 92 | run-occupancy.test.ts covers (a)-(g): parent-ended, archived claim excluded, branch and symlink matching, null harness_run, newer-ended/older-live, and the write spy. Red run [1], then 10/10 passing in [5][12][17]. The diff's service logic matches. Statuses filtered are only archived and deprecated. | 01M4QCSKM288TRJVYBNT7QBBHZ (evidence [1],[5],[12],[17]) |
| AC-WL-2 | 92 | The compiled e2e on a mkdtemp corpus checks: register leads to occupied true with the run id; run end leads to occupied false and ended true; no --worktree exits exactly 2. Red run [3] showed the command missing; passing runs [6][13][18]. The test also asserts that the binary is fresh. | 01M4QCSKM288TRJVYBNT7QBBHZ (evidence [3],[6],[13],[18]) |
| AC-WL-3 | 84 | 19 tests on a real repo with stub lore and lsof cover (a)-(h), including e2, the /proc fallback and own ancestry. Red run [2] showed the old liveness-window refusal; passing runs [7][14][19]. The hook source was not shown, so the logic is judged only through the tests. | 01M4QCSKM288TRJVYBNT7QBBHZ (evidence [2],[7],[14],[19]) |
| AC-WL-4 | 88 | The grep found the constant before the change [4] and passes in [8][15][20]. The manifest check is OK and the gate, distribution and ssot suites are green. The diff deletes the AC2/AC4 cases with nothing skipped. The detached-quiet AC5 pass case was also deleted; new test (a) replaces it. | 01M4QCSKM288TRJVYBNT7QBBHZ (evidence [4],[8],[15],[20]) |
| AC-WL-5 | 93 | bun run typecheck exits 0 across all sub-projects [9][16][21]. The store interface, the three stores, the service, the CLI and the test double (outline-service.test.ts) are all wired in the diff. | 01M4QCSKM288TRJVYBNT7QBBHZ (evidence [9],[16],[21]) |

## Gaps

- The hook implementation in assets/hooks/pre-bash-git-safety-gate.mjs is omitted from the diff. The lsof invocation, the ancestry exclusion and the JSON validation are evidenced only by tests that use stub executables.
- RunService.occupancy in packages/lore/src/service/run-service.ts excludes only archived and deprecated tasks as terminal. Any other terminal status would leave a claim counted as occupying.
- packages/lore/tests/unit/hooks/git-safety-gate.test.ts also deletes the AC5 detached clean+merged+quiet pass case, which is beyond the declared AC2/AC4 retirement. A detached case was re-added in packages/lore/tests/unit/hooks/git-safety-worktree-occupancy.test.ts.

## Recommendations

- Never truncate the primary behavioural source file (here the git-safety hook) from audit bundles. Truncate generated or test files first.
- Define 'non-terminal task' by referencing the canonical terminal-status set rather than leaving it implicit.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 35513ms
- Retried: false
- Truncated sections: diff:assets/hooks/pre-bash-git-safety-gate.mjs

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 88 | 0.75 | evidence | Service, store, CLI and hook tests cover every AC sub-case and pass. The hook implementation itself was not shown. |
| evidence_integrity | 88 | 0.8 | evidence | Red-first runs recorded for AC-WL-1 to AC-WL-4, three passing runs each, 81% attested. Two supporting runs have no output tail. |
| scope_fidelity | 85 | 0.75 | evidence | Changes stay within the plan. Extracting seat-claim-match is a justified refactor for reuse. Deleting the extra AC5 quiet case goes slightly beyond the AC2/AC4 retirement. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-WL-3 | The hook implementation in assets/hooks/pre-bash-git-safety-gate.mjs is omitted from the diff. The lsof invocation, the ancestry exclusion and the JSON validation are evidenced only by tests that use stub executables. |
| outcome | minor | AC-WL-1 | RunService.occupancy in packages/lore/src/service/run-service.ts excludes only archived and deprecated tasks as terminal. Any other terminal status would leave a claim counted as occupying. |
| scope_fidelity | minor | AC-WL-4 | packages/lore/tests/unit/hooks/git-safety-gate.test.ts also deletes the AC5 detached clean+merged+quiet pass case, which is beyond the declared AC2/AC4 retirement. A detached case was re-added in packages/lore/tests/unit/hooks/git-safety-worktree-occupancy.test.ts. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Never truncate the primary behavioural source file (here the git-safety hook) from audit bundles. Truncate generated or test files first. | The core decision logic could not be inspected. |
| spec | Define 'non-terminal task' by referencing the canonical terminal-status set rather than leaving it implicit. | This avoids a hardcoded status list drifting from the domain model. |

## Unverifiable Materials

- assets/hooks/pre-bash-git-safety-gate.mjs: Omitted from the diff because of the budget. The occupancy probe logic is seen only through the tests.
- Output of evidence [10] and [11]: No output tail was recorded for the store contract run across the three stores.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.81
