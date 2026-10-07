---
id: KN-563
type: knowledge
role: knowledge
title: "Assessment: CLAUDE.md root section-structure check and adoption mode (2026-10-07)"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
links:
  - {id: PLAN-149, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M4A7SQV174K2V04TGC4D6KGV`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-STR-1 | 90 | Shows RED (module not found), then 3 attested passes (32 tests). claude-md-structure.ts uses mdast: depth-2, top-level only, case-sensitive, mode-free (file, required) signatures. Matches the spec. | task-skill-test-structure-check-cli-adoption-surface-red, task-skill-implement-core-adoption-config-pure-h2-structure |
| AC-STR-2 | 88 | RED then 5 attested passes (20 tests). The diff shows resolveAdoption as the single default site, warn downgrading every kind, the WARN line on every warn run, and the JSON adoption block. Evidence [10] is tagged AC-STR-2 but runs other files. | task-skill-implement-core-adoption-config-pure-h2-structure, task-skill-test-structure-check-cli-adoption-surface-red |
| AC-STR-3 | 85 | RED (old schema refused adoption, so the binary was really used), then attested passes using the real binary plus a parity test. The hook diffs are omitted, so byte-identity rests only on the parity test. | task-skill-test-contract-section-parity-real-binary-pre-push, task-skill-implement-contract-prose-must-contain-in-order |
| AC-STR-4 | 86 | RED then attested passes (26 tests). Adoption is judged post-splice with real budgets pinned to enforce, and the write happens only when the key is absent. But the whole-config save writes every resolved default budget into the user's config. | task-skill-implement-setup-skeleton-managed-block-reshape, task-skill-test-setup-adoption-both-ends-fresh-install-red |
| AC-STR-5 | 88 | RED then attested passes (15 tests). memory-file-health.ts goes through runMemoryFileChecks, reads root files only, dedupes by realpath, and returns absent when enforce + clean. The schema field is optional, so zod does not strip it. | task-skill-implement-bootstrap-memory-file-health-via-shared, task-skill-test-bootstrap-memory-file-health-red |
| AC-STR-6 | 86 | RED then attested passes (11 tests). The refusal comes from the deterministic list after adoption is applied, and warn returns the downgraded findings. A comment in context-flow.ts saying advisory is 'computed and discarded' is now out of date. | task-skill-implement-lore-context-write-gate-honours-adoption |
| AC-STR-7 | 84 | RED (old 'exactly these headings' prose), then attested passes including the manifest --check. The contract asset is omitted from the diff, so its prose cannot be seen. | task-skill-implement-contract-prose-must-contain-in-order |
| AC-STR-8 | 65 | Only 1 attested pass. The task's own text (evict three subsections, echo 'three Architecture subsections evicted') differs from the spec AC that ran (Dogfooding kept as H2, Implementation Status renamed), with no Decisions Log entry. .lore/config.yaml is not in the changed files. | task-skill-implement-dogfood-evict-three-architecture |
| AC-STR-9 | 86 | RED (4 failing) then attested passes. status.ts now renders the WARN line and downgraded lines through shared render helpers, with no second composition. | task-skill-implement-check-memory-pointers-renders-warn |
| AC-STR-10 | 80 | RED (exit 3 vs 0) then attested passes (10 tests), plus neighbouring discovery suites green. real-memory-file-probe.ts is omitted, so the exclusion mechanism and its invariant header cannot be seen. | task-skill-implement-memory-file-probe-stops-at-nested-git |

## Gaps

- Exit criteria are not met. The review/gate task is draft with no evidence: no full bun run test:vitest / test:bun on main, no lore assess, and no check-drift.
- The dogfood task says to evict three Architecture subsections into knowledge-reference docs, but the executed AC keeps Dogfooding as its own H2 and renames Implementation Status. No Decisions Log entry, no linked knowledge docs, and the task AC's echo text does not match.
- writeAdoptionModeToConfig saves the whole resolved memory_files object, persisting schema-default budgets into the user's config. Later default changes will not reach them.
- downgraded_reference is declared on AdvisoryFinding but never set. A context-flow comment still says advisory output is discarded.

## Recommendations

- Complete the gate task: full uncached suites on main, then lore verify / assess / check-drift, and record the evidence.
- Add a Decisions Log entry for the AC-STR-8 approach change (rename / promote instead of evicting), and update the dogfood task AC text to match the spec AC.
- Specify that setup writes only the adoption key, not materialized default budgets.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 43728ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/flows/context-flow-adoption.test.ts, diff:packages/lore/tests/integration/bootstrap-memory-file-health.bun.test.ts, diff:packages/lore/tests/integration/status-claude-md-adoption.test.ts, diff:packages/lore/tests/unit/service/claude-md-structure.test.ts, diff:packages/lore/tests/integration/setup-claude-md-adoption.bun.test.ts, diff:packages/lore/tests/integration/pre-push-structure-trip.bun.test.ts, diff:packages/lore/tests/unit/assets/claude-md-contract-sections.test.ts, diff:bun.lock, diff:packages/lore/package.json, diff:packages/lore/tests/integration/claude-md-emphasis.test.ts, diff:packages/lore/tests/integration/claude-md-guard-hook-trip.bun.test.ts, diff:packages/lore/tests/integration/claude-md-slug-pointers.test.ts, diff:packages/lore/tests/integration/claude-md-wiring.test.ts, diff:packages/lore/tests/integration/pre-push-claude-md-trip.bun.test.ts, diff:packages/lore/tests/integration/status-claude-md-budget-provenance.test.ts, diff:packages/lore/tests/integration/status-claude-md.test.ts, diff:packages/lore/tests/unit/flows/context-flow.test.ts, diff:packages/lore/tests/integration/status-memory-pointers-adoption.test.ts, diff:assets/governance/claude-md-contract.md, diff:assets/project/pre-push, diff:hooks/pre-push, diff:assets/governance/claude-md-contract.md, diff:assets/project/CLAUDE.md.skeleton, diff:assets/project/CLAUDE.md.template, diff:assets/skills/lore-init-context/SKILL.md, diff:packages/lore/tests/integration/setup-user-once-marker.bun.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/flows/setup-project-claudemd.test.ts, diff:packages/lore/tests/unit/flows/setup-project-gitignore.test.ts, diff:scripts/embed-assets-manifest.mjs, diff:packages/lore/tests/integration/claude-md-nested-repo-discovery.test.ts, diff:CLAUDE.md, diff:packages/lore/src/adapters/real-memory-file-probe.ts, diff:.lore/export-index.json, diff:scripts/check-shipped-defaults.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All 10 ACs have attested passes and the core diff matches the spec. The full-suite and assess exit criteria are unmet, and the gate task is still draft. |
| evidence_integrity | 80 | 0.7 | evidence | Good RED-to-green trails with real-binary checks. AC-STR-8 has a single run, one record is tagged with the wrong AC, and some records are self-reported (8% unattested). |
| scope_fidelity | 72 | 0.6 | evidence | AC-STR-9/10 were added beyond the plan's 1..8 range. The dogfood approach drifted from eviction to a rename with no logged decision. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | Exit criteria are not met. The review/gate task is draft with no evidence: no full bun run test:vitest / test:bun on main, no lore assess, and no check-drift. |
| scope_fidelity | major | AC-STR-8 | The dogfood task says to evict three Architecture subsections into knowledge-reference docs, but the executed AC keeps Dogfooding as its own H2 and renames Implementation Status. No Decisions Log entry, no linked knowledge docs, and the task AC's echo text does not match. |
| outcome | minor | AC-STR-4 | writeAdoptionModeToConfig saves the whole resolved memory_files object, persisting schema-default budgets into the user's config. Later default changes will not reach them. |
| outcome | minor | — | downgraded_reference is declared on AdvisoryFinding but never set. A context-flow comment still says advisory output is discarded. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Complete the gate task: full uncached suites on main, then lore verify / assess / check-drift, and record the evidence. | These exit criteria are not evidenced at all. |
| plan | Add a Decisions Log entry for the AC-STR-8 approach change (rename / promote instead of evicting), and update the dogfood task AC text to match the spec AC. | Unlogged scope drift. |
| spec | Specify that setup writes only the adoption key, not materialized default budgets. | Stops config bloat and frozen defaults. |

## Unverifiable Materials

- packages/lore/src/adapters/real-memory-file-probe.ts: Omitted from the diff, so the nested-repo exclusion cannot be inspected.
- CLAUDE.md, .lore/config.yaml: The dogfood edits are omitted or not listed, so AC-STR-8 rests on one oracle run.
- assets/governance/claude-md-contract.md, hooks/pre-push, assets/project/pre-push: Prose and hook diffs are omitted, so they are judged only by the tests.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] The oracle passes with mode_source config, but .lore/config.yaml is absent from the changed-file list, so the dogfood config write cannot be confirmed. — ".lore/config.yaml" not found at commit e89fbf4fac97f1fa7ee0db5d590aa0464bf7e302

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 16 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.92
