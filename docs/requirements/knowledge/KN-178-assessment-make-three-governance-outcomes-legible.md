---
id: KN-178
type: knowledge
role: knowledge
title: "Assessment: Make three governance outcomes legible: vacuous plan-close passes, silent AC demotions, and the empty feeding pack a fresh install receives (2026-08-10)"
status: archived
priority: medium
created: 2026-08-10
updated: 2026-10-23
tags: []
parent: PLAN-078
links:
  - {id: PLAN-078, type: informs}
---
# Assessment: met (82/100)

Scope: plan `01KZN4F7772NR1BNYGNTRCQX4Z`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-GV-1 | 72 | RED→GREEN on the named oracle; checkPlanClose now pushes notApplicable('no-evidence') so vacuous≠satisfied structurally. But evidence stops at the registry return value — no diff or run shows the human/--json RENDER surfaces differentiating, which the AC text demands. | 01KZN4F7H8CYG2GXYGRDJHBN81 (expected-fail then pass, 7 tests; typecheck pass) |
| AC-GV-2 | 85 | Diff removes 'gate never evaluated' from tree-check-service.ts and the new test asserts both the absence and the corrected justification. Command text deliberately unchanged with a stated reason (sibling integration test pins it) — a defensible reading of 'the command it suggests'. | 01KZN4F7NXQ5HDMFFP36S7AC1W (expected-fail → pass, plus full tree-check suite pass) |
| AC-GV-3 | 92 | Strongest trail: RED evidence prints grep counts (1 / exit 1) before the edit and GREEN prints (0 / exit 0) after; CLAUDE.md diff visibly names corpus-service.ts:2029 and the vacuous-pass mechanism. Mechanically re-checkable by any reader. | 01KZN4F7NXQ5HDMFFP36S7AC1W (grep oracle RED+GREEN with raw output) |
| AC-GV-4 | 87 | Notice keyed on OBSERVED before/after status, not subcommand; real-CLI subprocess tests cover the load-bearing negative half (add, second set on draft spec, rejected write) with strict stderr==='' assertions, plus exact counts 2 and 0 and a stdout-channel check. | 01KZN4F7TKAS1MEPAQ1SDSSABZ (expected-fail → pass; 5 tests incl. NEGATIVE/STATE/ERROR/REGRESSION) |
| AC-GV-5 | 80 | Compiled-in fallback ships in corpus-service.ts (a real distribution surface) and an existing integration test was flipped from asserting [source: unknown] to asserting the fallback. Probe file itself is unseen, so the both-ends/no-write-to-repo claims rest on the runner's word. | 01KZN4F7Z7ANCTK31S0YH61KB3 (expected-fail → pass in worktree and on main tree) |

## Gaps

- The AC requires the vacuous/satisfied discriminator to be visible in BOTH human output and --json. The diff touches no renderer or CLI surface, and the oracle test asserts only on checkPlanClose's returned objects plus JSON.stringify of those objects. Whether the plan-close render path actually surfaces PredicateNotApplicable differently is plausible (attestationFloor/prdOutlineSynced already emit that shape) but unverified from these materials.
- Only assessmentFreshness was migrated. The updated JSDoc itself states any future predicate with an internal vacuous carve-out retains the limit, so 'every plan-close predicate reports WHY it passed' holds for today's set, not structurally.
- Seven existing fixtures gained assessmentFreshnessExempt:true to keep the newly-visible entry out of verdict counts. Comments are honest about why, but the effect is that the suites most focused on counting gate verdicts no longer exercise the new no-evidence entry at all.
- The both-ends probe file is omitted from the materials, so 'fresh mkdtemp + lore init AND this repo's corpus in the same run' and 'never writes to this repo's .lore/' cannot be confirmed; the 1.2s main-tree run duration is short for a real lore init subprocess.
- checkPlanClose now emits an extra notApplicable verdict that reaches GateEnforcer's advisory/audit path, adding gate-skip rows for assessment-less plans — a runtime side effect beyond making an outcome legible.

## Recommendations

- Split AC-GV-1 into a data-shape criterion (checkPlanClose emits a distinct discriminator) and a surface criterion (CLI --json payload and human render show it), each with its own oracle command.
- When a fix makes a previously-invisible verdict visible, require at least one pre-existing fixture to assert the new entry instead of exempting it away.
- Link the vacuous-pass and fresh-install-probe findings as knowledge docs on this plan.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 91716ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/gate-feeding-fresh-install.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.75 | evidence | All four mechanisms visibly land in shipped source with RED-first oracles; AC-GV-1 delivers the data-layer discriminator but not a demonstrated render-surface difference. |
| evidence_integrity | 78 | 0.7 | evidence | RED→GREEN pairs for 4/5 ACs incl. raw grep output for AC-GV-3; weakened by 0.21 attested ratio, one attested pass per AC, and an unseen AC-GV-5 probe file. |
| scope_fidelity | 88 | 0.8 | evidence | File-ownership constraints respected (corpus-service touched only by the task that owns it); cascade left ungated as instructed. Fixture-wide exempt flags are the main incidental spread. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-GV-1 | The AC requires the vacuous/satisfied discriminator to be visible in BOTH human output and --json. The diff touches no renderer or CLI surface, and the oracle test asserts only on checkPlanClose's returned objects plus JSON.stringify of those objects. Whether the plan-close render path actually surfaces PredicateNotApplicable differently is plausible (attestationFloor/prdOutlineSynced already emit that shape) but unverified from these materials. |
| outcome | minor | AC-GV-1 | Only assessmentFreshness was migrated. The updated JSDoc itself states any future predicate with an internal vacuous carve-out retains the limit, so 'every plan-close predicate reports WHY it passed' holds for today's set, not structurally. |
| evidence_integrity | minor | AC-GV-1 | Seven existing fixtures gained assessmentFreshnessExempt:true to keep the newly-visible entry out of verdict counts. Comments are honest about why, but the effect is that the suites most focused on counting gate verdicts no longer exercise the new no-evidence entry at all. |
| evidence_integrity | minor | AC-GV-5 | The both-ends probe file is omitted from the materials, so 'fresh mkdtemp + lore init AND this repo's corpus in the same run' and 'never writes to this repo's .lore/' cannot be confirmed; the 1.2s main-tree run duration is short for a real lore init subprocess. |
| scope_fidelity | minor | — | checkPlanClose now emits an extra notApplicable verdict that reaches GateEnforcer's advisory/audit path, adding gate-skip rows for assessment-less plans — a runtime side effect beyond making an outcome legible. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Split AC-GV-1 into a data-shape criterion (checkPlanClose emits a distinct discriminator) and a surface criterion (CLI --json payload and human render show it), each with its own oracle command. | One AC currently spans two layers; the oracle only covers the lower one, so the upper half passes by assumption. |
| process | When a fix makes a previously-invisible verdict visible, require at least one pre-existing fixture to assert the new entry instead of exempting it away. | Blanket exemption of affected fixtures restores green without proving the new path behaves in the contexts it changed. |
| plan | Link the vacuous-pass and fresh-install-probe findings as knowledge docs on this plan. | Tasks cite knowledge slugs as motivation but the plan records 0 linked knowledge docs. |

## Unverifiable Materials

- packages/lore/tests/unit/service/gate-feeding-fresh-install.test.ts: Omitted per truncation manifest; the both-ends construction and the 'never writes to this repo's .lore/' constraint rest on the runner's description alone.
- plan-close --json / human render path: No renderer file in the diff and no run shows rendered output, so AC-GV-1's surface-level requirement cannot be confirmed from these materials.
- check-tree.test.ts integration assertion cited as pinning the suggested command string: Referenced in a test comment to justify leaving the command unchanged, but the file is not in the diff.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.21
