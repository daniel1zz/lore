---
id: KN-572
type: knowledge
role: knowledge
title: "Assessment: Session-start injection carries only the seat's own items (2026-10-12)"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-157
links:
  - {id: PLAN-157, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01M4NV0ZAGZ6KY2CB9CT5T8JTJ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-SI-1 | 92 | Red run, then 3 attested passes (13 tests) on both the worktree and main. Diff matches the AC: null when seat is null or there is no claim/hint, key order is right, schema is .strict(), and the constants contain the required substrings and none of the banned ones. | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 1,3,14,25) |
| AC-SI-2 | 76 | First compiled e2e failed on an actor-identity collision between test claims (an environment problem, not the feature). After a red/green fix it passed at ev 26, but that tail shows only build output, not the bun test pass count. CLI diff shows exit 2 for an unpaired flag and empty stdout for the m… | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 15 fail, 22 red, 23/24/26 pass) |
| AC-SI-3 | 85 | Red run, then 2 attested passes covering cases (a)-(e) by name. The hook source (assets/hooks/session-start-resume.mjs) is not in the diff, so (f) and the argv wiring are seen only through the tests. | task-hook-phase-e-empty-injection-is-not-degradation-framing (ev 1,3,9) |
| AC-SI-4 | 76 | Same e2e file as AC-SI-2: failed first on the identity collision, then passed, but the final tail does not show the test summary. In the config diff the 3 retired knobs are optional with no default, warn once per key per process on stderr, and char_budget only sets the flag (never slices). | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 16 fail, 27 pass) |
| AC-SI-5 | 88 | Red recorded, then the full grep command passed. ev 6 caught a broken edit ('hook-injected lore bootstrap') that was fixed before ev 7 passed. The asset bodies are not in the diff. | task-prose-sweep-shipped-assets-say-pull-lore-bootstrap-when (ev 1,6,2/7) |
| AC-SI-6 | 92 | First typecheck failed on stale session-service.test.ts usage; after cleanup, 3 attested passes including on main (ev 28). | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 8 fail, 11/17/28 pass) |
| AC-SI-7 | 86 | --check OK in every task. The final digest on main, 6891f6..., matches the build. The manifest hunk in the diff shows c0b84a... (the hook task's digest), so that hunk is probably a partial view. | task-hook-phase-e-empty-injection-is-not-degradation-framing (ev 10), task-prose-sweep-shipped-assets-say-pull-lore-bootstrap-when (ev 3,8) |
| AC-SI-8 | 93 | The grep for the old name passed and both suites are green (24 tests). In the diff, RESUME_SCOPE_CLOSURE is built from BOOTSTRAP_RESUME_CLOSURE_KEYS, which is the corpus-global set plus resume_hint and my_claims. | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 6,18,29) |
| AC-SI-9 | 84 | Failed first, then 27 tests green on main. The claims that session-service.test.ts lost only the AC-080-2 case and that the mcp file changed only by rename cannot be checked, because those test diffs are omitted. | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 9 fail, 12/19/30 pass) |
| AC-SI-10 | 90 | Red run, then 14 tests passed 3 times. The seatClaims diff matches D11/D12: branch-or-absolute-path matching, an ENOENT fallback to path.resolve, terminal statuses excluded, ascending sort, read-only. | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 1,4,20,31) |
| AC-SI-11 | 88 | ev 10 shows the full command red; ev 13/21/32 show it passing. ev 7 used an older, weaker command. Old test bodies are not shown, so any retired wording the needles miss is checked only by diff review (I2). | task-core-service-cli-seat-only-injection-projection-seatclaims (ev 10 red, 13/21/32) |
| AC-SI-12 | 87 | Red run, then a pass showing 2 pass / 8 expects. The final pass on main shows only the build tail. | task-hook-phase-e-empty-injection-is-not-degradation-framing (ev 2,5,6,11) |

## Gaps

- Final passes of packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts on main show only build output in their tails; the pass count is not visible.
- In packages/lore/src/service/session-service.ts, resolveDirectory rethrows any error other than ENOENT for any claim, so one bad claim path fails seatClaims for every seat.
- Rename-only edits to packages/lore/tests/integration/cli-feed-task-start.bun.test.ts and packages/core/tests/unit/resume-coverage-constants.test.ts are not covered by I2's single named exception.

## Recommendations

- When recording build+test evidence, record the tail of the test step separately from the build output.
- Make I2 list every old test file that needs a rename because of the D8 constant split.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 55525ms
- Retried: false
- Truncated sections: diff:packages/core/tests/unit/bootstrap-injection-provenance.test.ts, diff:packages/core/tests/unit/bootstrap-injection.test.ts, diff:packages/core/tests/unit/bootstrap-seat-injection.test.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts, diff:packages/lore/tests/unit/adapters/mcp-session-tools.test.ts, diff:packages/lore/tests/unit/service/session-service-seat-claims.test.ts, diff:packages/lore/tests/unit/service/session-service.test.ts, diff:assets/hooks/session-start-resume.mjs, diff:packages/lore/tests/e2e/session-start-seat-injection-hook-compiled.bun.test.ts, diff:packages/lore/tests/unit/hooks/session-bootstrap-injection.test.ts, diff:packages/lore/tests/unit/hooks/session-bootstrap-seat-injection.test.ts, diff:packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:assets/agents/lore-explorer.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/project/CLAUDE.md.template, diff:assets/skills/lore-operate/SKILL.md, diff:assets/skills/lore-plan/references/mode-create.md, diff:assets/skills/lore-plan/references/mode-list.md, diff:assets/skills/lore-plan/references/mode-resume.md, diff:assets/skills/lore-plan/references/workflow-examples.md, diff:assets/skills/shared/lore-cli-map.md, diff:assets/skills/shared/project-context-loading.md, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts
- Reasoning clipped for: AC-SI-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.75 | evidence | Core, service and CLI diffs match the spec contract. Every AC ends with an attested pass. Hook and prose are verified only through their oracles. |
| evidence_integrity | 78 | 0.7 | evidence | Red-first runs recorded and failures resolved openly. Several final e2e tails lack the test summary, and ev 7 used a weaker AC-SI-11 command. |
| scope_fidelity | 85 | 0.7 | evidence | Changes stay within the 3 tasks. Edits outside the plan's stated list: rename-only edits to old tests beyond I2's single exception, and the .claude/rules feed mirror. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-SI-2 | Final passes of packages/lore/tests/e2e/bootstrap-seat-injection-compiled.bun.test.ts on main show only build output in their tails; the pass count is not visible. |
| outcome | minor | AC-SI-10 | In packages/lore/src/service/session-service.ts, resolveDirectory rethrows any error other than ENOENT for any claim, so one bad claim path fails seatClaims for every seat. |
| scope_fidelity | minor | — | Rename-only edits to packages/lore/tests/integration/cli-feed-task-start.bun.test.ts and packages/core/tests/unit/resume-coverage-constants.test.ts are not covered by I2's single named exception. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | When recording build+test evidence, record the tail of the test step separately from the build output. | The tails of the final passes showed no test result. |
| plan | Make I2 list every old test file that needs a rename because of the D8 constant split. | AC-SI-8 forces those renames, but I2 names only one file. |

## Unverifiable Materials

- assets/hooks/session-start-resume.mjs diff: Omitted; the Phase E logic is judged only from the AC-SI-3/12 oracles.
- packages/lore/tests/unit/service/session-service.test.ts diff: Omitted; AC-SI-9's claim that only the AC-080-2 case was removed cannot be checked.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.87
