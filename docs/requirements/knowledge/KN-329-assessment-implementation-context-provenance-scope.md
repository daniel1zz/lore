---
id: KN-329
type: knowledge
role: knowledge
title: "Assessment: Implementation — context provenance (scope-declaring injection + scope-closing resume ticket) (2026-07-30)"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-101
links:
  - {id: PLAN-101, type: informs}
---
# Assessment: partially_met (71/100)

Scope: plan `01KYRCSYQT9BZN3FFAB9K9MPVD`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CP-1 | 84 | Registered vitest filter 'first key' passes, incl. one attestation by main-orchestrator (T1 + T5 records). Output shows only 1 of 14 tests ran under the filter, so identity/token-iteration internals are unverifiable without the test source. | 01KYRCWWAF9VJWA25XJXFWTRZ2 (T1 ev[1],[5]), 01KYRCXKCH9DYB9K44Y4WZ2RB1 (T5 ev[9] attested) |
| AC-CP-2 | 82 | 'budget-exceeded' filter passes (3 pass, 1 attested). Degenerate declaration-alone case is claimed by T1 prose but the run shows 1 test / 13 skipped; payload-returned-intact and ledger-never-names-declaration assertions cannot be inspected. | 01KYRCWWAF9VJWA25XJXFWTRZ2 (T1 ev[2],[6]), 01KYRCXKCH9DYB9K44Y4WZ2RB1 (T5 ev[12] attested) |
| AC-CP-4 | 86 | Best-covered AC: 7 pass incl. attested e2e (15 expect calls) plus T3's separate MCP-surface, CLI-stdout and pure-render runs. Both surfaces named in test title; a non-resume checkpoint negative case is also recorded. | 01KYRCX76VD61PPVNP3R86HVWV (T3 ev[3],[4],[5]), 01KYRCXKCH9DYB9K44Y4WZ2RB1 (T5 ev[10] attested) |
| AC-CP-6 | 85 | Attested e2e 'fresh install' pass, 13 expect calls, ~3.3s runtime consistent with a real spawned binary against a temp corpus. Temp-root-outside-repo requirement rests on the test source, which is not in the materials. | 01KYRCXKCH9DYB9K44Y4WZ2RB1 (T5 ev[4],[8] attested) |
| AC-CP-7 | 48 | Oracle weakened vs AC text: the attested test title states corpus-workflow.md is 'retired from machine install' and checked via the governance verb, not a copy read back from --claude-dir. Only 1 of the 2 assets meets the stated installed-file oracle; T5 itself says storage parity is not distributi… | 01KYRCXKCH9DYB9K44Y4WZ2RB1 (T5 ev[11] attested; title contradicts AC statement), 01KYRCXJZAD8T3RNARQVNEJHTH (T4 manifest regen, unattested) |
| AC-CP-9 | 84 | Attested e2e 'governance rule' pass, 17 expect calls, title names the per-member iteration, the resume_hint carve-out and the paired zero-occurrence assertion. Carve-out is sanctioned by the AC text itself, so not drift; member lists unverifiable. | 01KYRCXKCH9DYB9K44Y4WZ2RB1 (T5 ev[3],[13] attested), 01KYRCXJZAD8T3RNARQVNEJHTH (T4 impl half) |
| AC-CP-10 | 72 | Attested 'framing line' e2e pass (15 expects) covering verb identity, unsplit JSON and fence composition. Counted against it: one recorded fail (T2 ev[5]) on the hook/framing suite, resolved only by later reruns with no stated cause, and T2's evidence is entirely unattested. | 01KYRCXKCH9DYB9K44Y4WZ2RB1 (T5 ev[1],[14] attested), 01KYRCX6SH6Q79B2JPXEHYK9VH (T2 ev[5] fail, ev[6],[7] rerun pass) |

## Gaps

- The AC requires both edited assets to be byte-identical between the assets SSOT path and a copy read back from the throwaway --claude-dir. The attested test title states corpus-workflow.md is 'retired from machine install' and is instead compared via the binary's own governance verb. That verifies embedding, not distribution — the exact substitution T5's own instructions forbid ('storage parity is not distribution; the oracle is the installed file'). Only the hook meets the stated oracle.
- attested_evidence_ratio is 0.17: T1, T2, T3, T4 (28 records) are entirely self-reported by worktree agents. All attestation is concentrated in T5, which is itself status=draft — so the trustworthy portion of the trail belongs to an unfinished task.
- diff_available=false and tests_touched=false. Nothing in the materials shows the five exported constants, the payload's leading key, the hook edit, the regenerated manifest digest, or a single e2e assertion. Every identity/verbatim/zero-occurrence claim is inferred from test names and pass counts, which cannot distinguish a strict assertion from a vacuous one.
- T2 ev[5] records a fail on the same governance-framing + hook-injection suite that ev[4] passed, with no stated cause; ev[6]/[7] then pass by splitting the command across two runners. The flake-vs-real-regression question is left unresolved.
- The plan requires the final integration run on a clean tree at a named commit because dirty concurrent checkouts were measured to produce phantom regressions. No evidence attests tree cleanliness; T5 ev[7] cites test:changed against a SHA only.
- T2 and T4 describe themselves as satisfying AC-CP-3 and AC-CP-5, which are retired and replaced by AC-CP-10 and AC-CP-9. Task records were not updated to the live AC ids, so traceability depends on T5's narrative.
- Zero knowledge docs captured, though the plan cites two non-obvious findings (the 2026-07-30 cross-session trespass and the measured dirty-checkout phantom regression) that future sessions cannot recover from code.

## Recommendations

- Rewrite AC-CP-7 to match the shipped reality: one asset byte-compared against its installed copy under --claude-dir, plus a separately named criterion for corpus-workflow.md's verb-served parity — or reinstate the two-asset installed-file oracle if machine install was not meant to be retired.
- Block plan closure while any contributing task is status=draft, and require attested reruns for the registered oracle of each task before archiving.
- Require the diff (or at minimum the changed-file list with the added assertions) in the audit bundle whenever ACs assert constant identity, verbatim text, or zero literal occurrences.
- When an AC is retired and replaced, update the implementing tasks' 'satisfies' lines to the replacement ids rather than leaving the mapping in a downstream task's prose.
- Require a recorded fail to carry a cause note and the change that resolved it before a passing rerun supersedes it.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 82155ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-CP-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 74 | 0.68 | evidence | Six of seven ACs have attested passing oracles with plausible expect counts; AC-CP-7's oracle was substituted mid-flight so distribution parity is proven for only one of two assets. |
| evidence_integrity | 52 | low | absence | Attested ratio 0.17, no diff, tests_touched false, one unexplained fail, and every attested run sits on a still-draft task. Claims verifiable only via test titles. |
| scope_fidelity | 71 | 0.6 | evidence | Task set maps to the three declared phases with no extraneous work; deductions for the AC-CP-7 oracle substitution and for T2/T4 still naming retired AC-CP-3/AC-CP-5. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-CP-7 | The AC requires both edited assets to be byte-identical between the assets SSOT path and a copy read back from the throwaway --claude-dir. The attested test title states corpus-workflow.md is 'retired from machine install' and is instead compared via the binary's own governance verb. That verifies embedding, not distribution — the exact substitution T5's own instructions forbid ('storage parity is not distribution; the oracle is the installed file'). Only the hook meets the stated oracle. |
| evidence_integrity | major | — | attested_evidence_ratio is 0.17: T1, T2, T3, T4 (28 records) are entirely self-reported by worktree agents. All attestation is concentrated in T5, which is itself status=draft — so the trustworthy portion of the trail belongs to an unfinished task. |
| evidence_integrity | major | — | diff_available=false and tests_touched=false. Nothing in the materials shows the five exported constants, the payload's leading key, the hook edit, the regenerated manifest digest, or a single e2e assertion. Every identity/verbatim/zero-occurrence claim is inferred from test names and pass counts, which cannot distinguish a strict assertion from a vacuous one. |
| evidence_integrity | minor | AC-CP-10 | T2 ev[5] records a fail on the same governance-framing + hook-injection suite that ev[4] passed, with no stated cause; ev[6]/[7] then pass by splitting the command across two runners. The flake-vs-real-regression question is left unresolved. |
| evidence_integrity | minor | — | The plan requires the final integration run on a clean tree at a named commit because dirty concurrent checkouts were measured to produce phantom regressions. No evidence attests tree cleanliness; T5 ev[7] cites test:changed against a SHA only. |
| scope_fidelity | minor | — | T2 and T4 describe themselves as satisfying AC-CP-3 and AC-CP-5, which are retired and replaced by AC-CP-10 and AC-CP-9. Task records were not updated to the live AC ids, so traceability depends on T5's narrative. |
| outcome | minor | — | Zero knowledge docs captured, though the plan cites two non-obvious findings (the 2026-07-30 cross-session trespass and the measured dirty-checkout phantom regression) that future sessions cannot recover from code. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Rewrite AC-CP-7 to match the shipped reality: one asset byte-compared against its installed copy under --claude-dir, plus a separately named criterion for corpus-workflow.md's verb-served parity — or reinstate the two-asset installed-file oracle if machine install was not meant to be retired. | The attested test title openly diverges from the AC text, so the AC currently overstates what is proven. |
| process | Block plan closure while any contributing task is status=draft, and require attested reruns for the registered oracle of each task before archiving. | 0.17 attested ratio with all attestation on a draft task is the bundle's weakest link. |
| process | Require the diff (or at minimum the changed-file list with the added assertions) in the audit bundle whenever ACs assert constant identity, verbatim text, or zero literal occurrences. | Pass counts alone cannot distinguish a strict identity assertion from a vacuous one. |
| plan | When an AC is retired and replaced, update the implementing tasks' 'satisfies' lines to the replacement ids rather than leaving the mapping in a downstream task's prose. | T2/T4 still cite retired AC-CP-3/AC-CP-5, breaking direct traceability. |
| process | Require a recorded fail to carry a cause note and the change that resolved it before a passing rerun supersedes it. | AC-CP-10's single fail is currently indistinguishable from a suppressed regression. |

## Unverifiable Materials

- Implementation diff / changed-file set: diff_available=false; no source for the constants, payload key order, hook edit, or FEED rule text.
- tests/e2e/context-provenance-compiled.bun.test.ts source: Not provided; assertion strength and the per-member iterations are inferred from test titles and expect counts only.
- packages/core/tests/unit/bootstrap-injection-provenance.test.ts source: Filtered runs executed 1 of 14 tests; the skipped 13 and the assertion bodies are invisible.
- Regenerated embedded assets manifest digest: No bytes or digest shown; coverage of both T2- and T4-edited assets is asserted, not demonstrated.
- Tree cleanliness at the named integration commit: The plan requires a clean tree; no oracle records worktree status.
- Attestation mechanics for agent:main-orchestrator records: Cannot confirm from the bundle how attested_count=7 was independently established.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.17
