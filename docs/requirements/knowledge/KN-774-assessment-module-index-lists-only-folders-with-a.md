---
id: KN-774
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
# Assessment: met (82/100)

Scope: plan `01M57NHS8W80XBA8W8F88GEY3J`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MI-1 | 88 | Red-first then 4 attested passes. Facts and renderer list only memory-file folders, add one count line, use 'no Purpose section' as a fallback, and exclude hidden/ignored folders. A truncation notice covers the walk cap. The HAPPY test asserts 43 and the BOUNDARY test asserts exactly 40. Sentence e… | 01M57NJ4VQF1VMTJA5C12H4649 (evidence [1] expected-fail; [4],[8],[10] pass), 01M57R7FF41BTP3P5FZ6KDTJCP (evidence [2] pass after MI-T3) |
| AC-MI-2 | 85 | Managed zone now emits '## Module Index' and '## Finding Live Project State'. migrateLegacyAutoBlocks is pure and idempotent, and the CLI reports migrated blocks by name. After MI-T3 the test asserts status --check-claude-md exits 0. Hand-text preservation is checked with toContain/order checks, no… | 01M57NJ4VQF1VMTJA5C12H4649 (evidence [2] expected-fail; [5],[9],[11] pass), 01M57R7FF41BTP3P5FZ6KDTJCP (evidence [3],[8] pass with exact exit assertion) |
| AC-MI-3 | 76 | --check is implemented with no CAS and no write, exits 1 naming differing files and findings, and the throwaway tests pass. The on-main run shows 'every target is already refreshed' and status passes. The AC text still names 'lore governance claude-md --check', which MI-T3 says does not exist and w… | 01M57NJ6E3TSXR363AWSQFPQPC (evidence [4] on-main oracle pass), 01M57NJ4VQF1VMTJA5C12H4649 (evidence [3] expected-fail, [6] throwaway pass, [12] duplicate of on-main run) |

## Gaps

- AC-MI-3 requires 'lore governance claude-md --check exits 0' on main. MI-T3 states that command does not exist, and the oracle substitutes 'lore status --check-claude-md'. The spec text was not shown corrected for AC-MI-3.
- The throwaway-half describe block in packages/lore/tests/integration/context-module-index.test.ts was renamed from 'AC-MI-3 (throwaway half)' to 'refresh --check: ...', so the earlier -t 'AC-MI-3' evidence no longer maps to a selectable test.
- MI-T1 evidence [12] has the same bytes as MI-T2's on-main oracle run. MI-T2 checks [1],[2] ran in a scratchpad copy, not main, and are labelled oracle=lint.
- MAX_MODULE_INDEX_ENTRIES in packages/lore/src/service/context-facts.ts went from 500 to 20000, and every listed memory file is now read during the walk. No performance evidence is recorded.
- packages/dashboard/CLAUDE.md Purpose now repeats itself (prepended summary plus original 'Web UI ... Vite + React 19' sentence), which hurts the readability the risk register was meant to protect.

## Recommendations

- Update the AC-MI-3 statement to require `lore status --check-claude-md` exit 0 instead of the non-existent `lore governance claude-md --check`.
- Bind evidence records to the task that produced them, and set the oracle kind honestly (scratchpad runs are not lint).
- When renaming tests, keep the AC id in the describe/it title so `-t <AC>` oracles stay selectable.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 49228ms
- Retried: false
- Truncated sections: diff:CLAUDE.md
- Reasoning clipped for: AC-MI-1, AC-MI-2, AC-MI-3

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All three ACs are implemented with passing oracles. The AC-MI-3 text still names a non-existent governance command; the root CLAUDE.md is unseen. |
| evidence_integrity | 74 | 0.65 | evidence | Red-first fails are recorded for each AC and passes are attested. One on-main run is duplicated across tasks, scratchpad runs are labelled lint, and renamed tests weaken -t traceability. |
| scope_fidelity | 85 | 0.7 | evidence | Changes stay within the planned files. MI-T3 is an explained assess-driven addition. Module Purpose edits match MI-T2's mitigation. MAX entries raised 500 to 20000 without justification. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-MI-3 | AC-MI-3 requires 'lore governance claude-md --check exits 0' on main. MI-T3 states that command does not exist, and the oracle substitutes 'lore status --check-claude-md'. The spec text was not shown corrected for AC-MI-3. |
| evidence_integrity | minor | AC-MI-3 | The throwaway-half describe block in packages/lore/tests/integration/context-module-index.test.ts was renamed from 'AC-MI-3 (throwaway half)' to 'refresh --check: ...', so the earlier -t 'AC-MI-3' evidence no longer maps to a selectable test. |
| evidence_integrity | minor | AC-MI-3 | MI-T1 evidence [12] has the same bytes as MI-T2's on-main oracle run. MI-T2 checks [1],[2] ran in a scratchpad copy, not main, and are labelled oracle=lint. |
| scope_fidelity | minor | — | MAX_MODULE_INDEX_ENTRIES in packages/lore/src/service/context-facts.ts went from 500 to 20000, and every listed memory file is now read during the walk. No performance evidence is recorded. |
| outcome | minor | — | packages/dashboard/CLAUDE.md Purpose now repeats itself (prepended summary plus original 'Web UI ... Vite + React 19' sentence), which hurts the readability the risk register was meant to protect. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Update the AC-MI-3 statement to require `lore status --check-claude-md` exit 0 instead of the non-existent `lore governance claude-md --check`. | Spec text and oracle disagree; an auditor cannot attest a clause that names a missing command. |
| process | Bind evidence records to the task that produced them, and set the oracle kind honestly (scratchpad runs are not lint). | Duplicate or mislabelled evidence lowers trust in the attestation trail. |
| skill | When renaming tests, keep the AC id in the describe/it title so `-t <AC>` oracles stay selectable. | Traceability from AC to test depends on name filters. |

## Unverifiable Materials

- CLAUDE.md (root) diff: Omitted from the diff; the generated Module Index lines and ceiling state on main cannot be inspected.
- CL-7 archive state and BR-882 modify: Exit criterion and plan deliverable with no evidence in the materials.
- spec AC-MI-2 corrected text: MI-T3 says the orchestrator corrects AC text; only the table version is visible.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.83
