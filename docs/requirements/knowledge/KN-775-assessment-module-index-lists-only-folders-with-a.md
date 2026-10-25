---
id: KN-775
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
# Assessment: met (83/100)

Scope: plan `01M57NHS8W80XBA8W8F88GEY3J`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MI-1 | 90 | Red-first fail then 3 attested passes. The diff renders link + first Purpose sentence, 'no Purpose section' and one count line, and flags a truncated walk. The tests cover exact-40, no-Purpose and hidden/ignored folders. The HAPPY test counts 43 because grouping folders are included, which is defen… | task-skill-implement-mi-t1-module-index-lists-only-folders-with (evidence [1] expected-fail, [4] and [8] pass), task-skill-fix-mi-t3-refresh-check-labels-section-findings-by (evidence [2] pass) |
| AC-MI-2 | 85 | The managed zone emits both template H2s. migrateLegacyAutoBlocks reports each block by name and preserves hand text. MI-T3 added the exact exit-0 assertion. Byte preservation is only checked with substring and order checks, not by comparing the whole file. Red-first fail and 4 attested passes. | task-skill-implement-mi-t1-module-index-lists-only-folders-with (evidence [2] expected-fail, [5] and [9] pass), task-skill-fix-mi-t3-refresh-check-labels-section-findings-by (evidence [3] and [8] pass with the exit-code assertion) |
| AC-MI-3 | 76 | The throwaway half has red/green test evidence. The on-main oracle passed once (MI-T2 [4]), but its working directory and commit are not shown, and the earlier lint runs used a scratchpad copy. MI-T3 renamed the throwaway describe block, so -t 'AC-MI-3' no longer selects it. | task-skill-docs-mi-t2-refresh-this-repository-s-root-claude-md (evidence [4] attested pass; [1] and [2] ran in a scratchpad wt-copy), task-skill-implement-mi-t1-module-index-lists-only-folders-with (evidence [3] expected-fail, [6] pass) |

## Gaps

- The AC-MI-3 on-main attestation does not record its working directory or commit. The related MI-T2 lint runs used a scratchpad wt-copy, not main.
- The throwaway --check tests in packages/lore/tests/integration/context-module-index.test.ts were renamed away from the 'AC-MI-3' prefix, so -t 'AC-MI-3' no longer selects them.
- The --check report shape changed from ceilingBreach to findings in packages/lore/src/flows/context-flow.ts, which breaks --json consumers without a note.
- The Purpose edit in packages/dashboard/CLAUDE.md repeats its opening sentence, which hurts the generated index line's neighbour text.

## Recommendations

- Require on-main AC attestations to record the commit SHA and repo-root working directory.
- When renaming test describe blocks, keep the AC id prefix that the verify filters depend on.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 36057ms
- Retried: false
- Truncated sections: diff:CLAUDE.md
- Reasoning clipped for: AC-MI-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | The diff implements all three ACs coherently: index filtering, template headings, legacy migration, --check and honest finding labels. On-main state is only partly visible. |
| evidence_integrity | 76 | 0.65 | evidence | Red-first fails, attested passes and the ledger cleanup are present. The on-main run has no working directory or SHA, some lint evidence ran on a scratchpad copy, and the describe rename weakens the … |
| scope_fidelity | 88 | 0.7 | evidence | The changes map to MI-T1, MI-T2 and MI-T3. The module Purpose edits follow the risk-register mitigation. Raising the walk cap to 20000 is justified in the code. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-MI-3 | The AC-MI-3 on-main attestation does not record its working directory or commit. The related MI-T2 lint runs used a scratchpad wt-copy, not main. |
| evidence_integrity | minor | AC-MI-3 | The throwaway --check tests in packages/lore/tests/integration/context-module-index.test.ts were renamed away from the 'AC-MI-3' prefix, so -t 'AC-MI-3' no longer selects them. |
| outcome | minor | — | The --check report shape changed from ceilingBreach to findings in packages/lore/src/flows/context-flow.ts, which breaks --json consumers without a note. |
| outcome | minor | — | The Purpose edit in packages/dashboard/CLAUDE.md repeats its opening sentence, which hurts the generated index line's neighbour text. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require on-main AC attestations to record the commit SHA and repo-root working directory. | Without them, a pass from a worktree or copy cannot be told apart from a pass on main. |
| skill | When renaming test describe blocks, keep the AC id prefix that the verify filters depend on. | This keeps the AC oracles selectable. |

## Unverifiable Materials

- CLAUDE.md (root) diff: Omitted from the diff, so the refreshed root content cannot be inspected.
- CL-7 archive status: No evidence record shows CL-7 was archived.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.81
