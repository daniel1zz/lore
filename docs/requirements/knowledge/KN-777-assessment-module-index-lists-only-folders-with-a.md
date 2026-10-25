---
id: KN-777
type: knowledge
role: knowledge
title: "Assessment: Module index lists only folders with a memory file (2026-10-18)"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-239
links:
  - {id: PLAN-239, type: informs}
---
# Assessment: partially_met (77/100)

Scope: plan `01M57NHS8W80XBA8W8F88GEY3J`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MI-1 | 82 | Implemented: memoryModules, Purpose extraction, a 'no Purpose section' fallback, a count line and a truncation notice. Red-first then attested passes on main. HAPPY test expects 43 not 40 (it counts grouping dirs); a flat BOUNDARY test asserts 40. Hidden and ignored folders are covered. | task-skill-implement-mi-t1-module-index-lists-only-folders-with (evidence [1] expected-fail, [4] and [8] pass) |
| AC-MI-2 | 74 | Template H2s now come from the managed zone; migrateLegacyAutoBlocks reports each block by name and is idempotent. Gaps: the test uses status --check-claude-md, not governance claude-md --check. Byte preservation is checked with toContain on fragments, not an exact comparison of all outside text. | task-skill-implement-mi-t1-module-index-lists-only-folders-with (evidence [2] expected-fail, [5] and [9] pass) |
| AC-MI-3 | 72 | --check works and has throwaway tests (stale file exits 1 with bytes unchanged; ceiling case). The AC-MI-3 attestation output shows refreshed state and within budget. Two evidence runs used a scratchpad wt-copy, and the [4] cwd is unstated, so 'on main' is not proven. Governance claude-md --check w… | task-skill-docs-mi-t2-refresh-this-repository-s-root-claude-md (evidence [4] AC-MI-3 pass; [1] and [2] ran in scratchpad/wt-copy), task-skill-implement-mi-t1-module-index-lists-only-folders-with (evidence [3] expected-fail, [6] pass (throwaway half)) |

## Gaps

- The AC-MI-3 on-main half is not shown to run on main. Lint evidence ran in a scratchpad wt-copy, and the cwd of the attested run is not recorded.
- The spec requires `lore governance claude-md --check` to report no section_missing. packages/lore/tests/integration/context-module-index.test.ts checks `lore status --check-claude-md` instead and does not assert the exit code.
- The HAPPY test in packages/lore/tests/integration/context-module-index.test.ts expects a count of 43 rather than the spec's 40, because it counts grouping folders. Only the flat BOUNDARY variant asserts 40.
- In packages/lore/src/flows/context-flow.ts, check mode reuses claudeMdRefusalMessage as ceilingBreach. Under enforce, that message includes section findings, which are then printed as 'ceiling:'.
- The plan's 'BR-882 modify lands with the plan' and the exit criterion 'CL-7 archived' have no evidence in the materials.

## Recommendations

- Align the AC-MI-2 and AC-MI-3 statements and verify commands on a single section-check command (governance claude-md --check vs status --check-claude-md).
- Require on-main attestations to record the cwd and commit SHA.
- Add an explicit evidence item for the BR-882 modification and the CL-7 archive.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 37475ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-MI-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | All three ACs are implemented and tested. Minor deviations: substitute check command, 43-vs-40 interpretation, and the on-main run is not proven. |
| evidence_integrity | 70 | 0.6 | evidence | Red-first evidence exists and passes are attested. Some MI-T2 runs used a scratchpad copy, and AC-MI-3's on-main context is unrecorded. |
| scope_fidelity | 82 | 0.65 | evidence | Changes match the MI-T1/T2 files. The walk cap jump 500→20000 and the Purpose rewrites match the plan's risk mitigation. BR-882 and the CL-7 archive are not shown. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-MI-3 | The AC-MI-3 on-main half is not shown to run on main. Lint evidence ran in a scratchpad wt-copy, and the cwd of the attested run is not recorded. |
| outcome | minor | AC-MI-2 | The spec requires `lore governance claude-md --check` to report no section_missing. packages/lore/tests/integration/context-module-index.test.ts checks `lore status --check-claude-md` instead and does not assert the exit code. |
| outcome | minor | AC-MI-1 | The HAPPY test in packages/lore/tests/integration/context-module-index.test.ts expects a count of 43 rather than the spec's 40, because it counts grouping folders. Only the flat BOUNDARY variant asserts 40. |
| outcome | minor | AC-MI-3 | In packages/lore/src/flows/context-flow.ts, check mode reuses claudeMdRefusalMessage as ceilingBreach. Under enforce, that message includes section findings, which are then printed as 'ceiling:'. |
| scope_fidelity | minor | — | The plan's 'BR-882 modify lands with the plan' and the exit criterion 'CL-7 archived' have no evidence in the materials. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Align the AC-MI-2 and AC-MI-3 statements and verify commands on a single section-check command (governance claude-md --check vs status --check-claude-md). | The statement and the oracle currently name different commands. |
| process | Require on-main attestations to record the cwd and commit SHA. | Without them, a scratchpad-copy run cannot be told apart from a run on main. |
| plan | Add an explicit evidence item for the BR-882 modification and the CL-7 archive. | Both exit criteria are currently unverifiable. |

## Unverifiable Materials

- cwd/commit of AC-MI-3 evidence [4]: The command has no recorded directory, so the on-main claim cannot be confirmed.
- BR-882 modification record and CL-7 archive state: Neither appears in the diff or the evidence.
- lore governance claude-md --check output on main: No evidence ran this command.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.77
