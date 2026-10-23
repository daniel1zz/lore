---
id: KN-229
type: knowledge
role: knowledge
title: "Assessment: Implementation — assess evidence projection and absence-finding suppression (2026-08-01)"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-23
tags: []
parent: PLAN-082
links:
  - {id: PLAN-082, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KYYB0EVT7YBAMRTC2E3A3Z4Y`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-AEP-1 | 92 | Diff-verified: renderTaskEvidence emits oracle/ac_ref/result/command and always tail_bytes (`e.output_tail ? Buffer.byteLength(...) : 0`), so an absent/empty tail renders tail_bytes=0 rather than omitting the field. 3 pass, 1 attested, 0 fail. | 01KYYB2C2ZD4YN20KSEVDF0V10 (T3 rows [14] re-run on committed tree) |
| AC-AEP-2 | 60 | Passes, but the clause cannot hold as written: truncateSection measures task.content ALONE (unchanged), so projecting evidence can never change whether truncated[] gains the entry. The diff's own comment concedes the test measures the assembled block, not the truncation flag. | 01KYYB2C2ZD4YN20KSEVDF0V10 (T3 row [3]/[15]) |
| AC-AEP-3 | 90 | Diff shows `truncated.push(`task:${task.slug}`)` untouched in both builders and in the T5-extracted shared core. Guard test passes for v5 and v6; byte-identity asserted, not a prefix check. | 01KYYB2C2ZD4YN20KSEVDF0V10 (T3 rows [4]/[10]/[16]) |
| AC-AEP-4 | 85 | Both builders call the same renderTaskEvidence, so row shape is identical by construction. Divergence remains in full-tail visibility (v5 uses declaredCriteria, v6 scopedDeclaredCriteria) — recorded as by-design in a CONTROL, not hidden. | 01KYYB2C2ZD4YN20KSEVDF0V10 (T3 rows [5]/[11]/[17]) |
| AC-AEP-5 | 88 | suppressUngroundedAbsenceFindings removes the flagged entry and appends an unverifiable[] entry naming it; wired into _finalizeAssessment with typed_gaps/unverifiable destructured out of restParsed. RED recorded with non-empty tail, then green. | 01KYYB2C8WMC2W9HSX5V2AXCMY (T4 rows [1] RED, [3]/[9] green) |
| AC-AEP-6 | 88 | Visible tests cover evidence-based (kept intact), grounded-absence (kept, original citation preserved, no duplicate appended), and no-dimension_scores no-op. Suppression is scoped to findUngroundedAbsenceDimensions' output only. | 01KYYB2C8WMC2W9HSX5V2AXCMY (T4 rows [4]/[10]) |
| AC-AEP-7 | 85 | Real disagreement case built through the production path: slug 'scoped' contains dimension key 'scope' without equalling it; the substring rule grounds it and the entry survives. T6 adds a second exact-equality join on typed_gaps[].dimension, but that field is a schema enum, so it is safe and expli… | 01KYYB2C8WMC2W9HSX5V2AXCMY (T4 rows [5]/[11]) |
| AC-AEP-8 | 85 | Diff preserves fullyTruncated → verdict='inconclusive' plus overall_score omission via destructure-and-omit; test asserts verdict, `'overall_score' in result` false, overall_confidence 'low', degraded_by_truncation true, while suppression runs in the same call. RED recorded. | 01KYYB2C8WMC2W9HSX5V2AXCMY (T4 rows [2] RED, [6]/[12]) |
| AC-AEP-9 | 88 | ASSESS_PROMPT_VERSION = 7 in diff; ASSESS_TEMPLATES[6] binds buildAssessPromptV6Frozen → renderTaskEvidenceV6Frozen, a verbatim copy of the pre-a639485 renderer. RED captured against stashed pre-fix source. Freeze covers the renderer only; the rest of the shared core still floats. | 01KYYG0HN3WGX2S00M4VRAAXWY (T5 rows [1] RED, [3]/[7]) |
| AC-AEP-10 | 90 | assembleFactsBasedAssessPrompt takes an injected EvidenceRenderer; both registry entries delegate to it — no forked twin, confirmed line-by-line in the diff. Tests assert distinct function references and identical prompts outside the evidence lines. | 01KYYG0HN3WGX2S00M4VRAAXWY (T5 rows [2] RED, [4]/[8]) |
| AC-AEP-11 | 78 | Implemented correctly in the diff: typed_gaps filtered by the SAME ungrounded list and deriveLegacyFindings now consumes the filtered array while the presence check stays on parsed.typed_gaps. But T6 records NO expected-fail row despite its own oracle demanding 'RED first'; only 1 test matched. | 01KYYGW3PHH2NDXXT9PFH6AQWZ (T6 rows [1]/[3], both green, no RED) |
| AC-AEP-12 | 75 | 3 tests pass and the grounded/evidence controls follow from the shared ungrounded list. The 'no clean verdict when typed_gaps empties' clause is satisfied by inheritance — verdict/summary are simply never recomputed — not by any mechanism added here; assertions not visible in the shown diff. | 01KYYGW3PHH2NDXXT9PFH6AQWZ (T6 rows [2]/[4]) |

## Gaps

- ASSESS_TEMPLATES[5] still binds buildAssessPrompt, which T3 switched to the projected renderTaskEvidence and T5 never touched. An assessment stamped prompt_version=5 therefore renders differently before and after a639485 — the identical reproducibility break T5 exists to close, left open for v5. The registry JSDoc in the same commit still describes `5` as 'the frozen v5 entry (buildAssessPrompt, provenance only)', which is now false.
- AC-AEP-2's premise cannot hold. truncateSection(task.content, max_task_chars) measures task.content alone — evidence text never entered it — so projecting evidence rows cannot move a task out of truncated[]. If the body 'previously overflowed max_task_chars', it still overflows. The passing test instead measures the assembled block (content+evidence) against max_task_chars, a comparison production never performs; assess-template.ts's own comment concedes this ('not via this truncation flag'). T…
- attested_evidence_ratio is 0.29 (T3: 4 attested of 13 self-reported; T5: 2 of 6). Worse, T3 rows [2]-[5] and [8]-[13] place hand-authored narrative in output_tail ('2 tests matched (AC-AEP-2 lone token), both passed...') rather than raw command output. A paraphrase in the output_tail field is precisely the substitution the governing spec's projection was written to expose. The later rows [14]-[17] do carry genuine vitest output, which is the correct form.
- T6's own Oracle section opens with 'RED first: ... before the fix, still carry that typed gap', yet all four T6 evidence rows are result=pass. T3 and T4 both recorded expected-fail rows with non-empty tails; T6 dropped the discipline. Without a RED, nothing demonstrates the AC-AEP-11/12 tests would have failed against the pre-T6 code, so the tests are unproven as discriminating.
- T5 row [6] records `bun run test:changed` as result=fail (1008 pass / 1 fail) with an explanation that the failure is pre-existing and already fixed on main at c61d688. That claim is plausible and specific, but nothing in the provided materials corroborates c61d688 or that the failing file is untouched by this diff, and no post-merge green re-run of the full changed-test set is recorded.
- buildAssessPromptV7 is a byte-identical duplicate wrapper of buildAssessPromptV6 — same signature, same delegation, same renderer. Two exported names for one behaviour in a module whose stated lesson is that a shared symbol drifting between versions caused the original defect; the JSDoc explaining why both exist is longer than either function body.

## Recommendations

- Add a follow-up task that either freezes ASSESS_TEMPLATES[5] against a pre-a639485 renderer (mirroring buildAssessPromptV6Frozen) or removes key 5 from the registry, and extend the AC-AEP-9 freeze test to cover getAssessTemplate(5).
- Restate AC-AEP-2 in terms production actually measures — e.g. 'the rendered evidence block for a 10-row task stays under N chars' — and drop the truncated[] clause, which cannot be affected by evidence projection.
- Require a non-empty expected-fail (RED) evidence row per new AC before a task may be archived, and reject output_tail values that are prose summaries rather than captured command output.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Duration: 156826ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/service/assessment-finalize-downgrade.test.ts, diff:packages/lore/tests/unit/ai/assess-evidence-projection.test.ts, diff:packages/lore/tests/unit/ai/assess-prompt-version-freeze.test.ts, diff:packages/lore/tests/unit/ai/assess-template-registry.test.ts, diff:packages/lore/tests/unit/service/ai-provider-service-assess.test.ts, diff:packages/lore/tests/unit/service/assess-absence-suppression.test.ts
- Reasoning clipped for: AC-AEP-7

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.8 | evidence | Both slices land and are diff-verified end-to-end. Two real holes: ASSESS_TEMPLATES[5] was never frozen despite T5's purpose, and AC-AEP-2's truncated[] clause is unachievable as stated. |
| evidence_integrity | 66 | 0.8 | evidence | attested ratio 0.29 (T3: 4/13). Several early output_tail fields carry hand-authored prose, not raw output — the exact substitution this spec exists to prevent. T6 recorded no RED. |
| scope_fidelity | 85 | 0.8 | evidence | Anchors respected; frozen task:<slug> vocabulary untouched. T5/T6 were declared follow-ups, and T6 explicitly recorded its typed_recommendations decision as required. Minor: a redundant V7 alias wrap… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-AEP-9 | ASSESS_TEMPLATES[5] still binds buildAssessPrompt, which T3 switched to the projected renderTaskEvidence and T5 never touched. An assessment stamped prompt_version=5 therefore renders differently before and after a639485 — the identical reproducibility break T5 exists to close, left open for v5. The registry JSDoc in the same commit still describes `5` as 'the frozen v5 entry (buildAssessPrompt, provenance only)', which is now false. |
| outcome | major | AC-AEP-2 | AC-AEP-2's premise cannot hold. truncateSection(task.content, max_task_chars) measures task.content alone — evidence text never entered it — so projecting evidence rows cannot move a task out of truncated[]. If the body 'previously overflowed max_task_chars', it still overflows. The passing test instead measures the assembled block (content+evidence) against max_task_chars, a comparison production never performs; assess-template.ts's own comment concedes this ('not via this truncation flag'). T… |
| evidence_integrity | major | — | attested_evidence_ratio is 0.29 (T3: 4 attested of 13 self-reported; T5: 2 of 6). Worse, T3 rows [2]-[5] and [8]-[13] place hand-authored narrative in output_tail ('2 tests matched (AC-AEP-2 lone token), both passed...') rather than raw command output. A paraphrase in the output_tail field is precisely the substitution the governing spec's projection was written to expose. The later rows [14]-[17] do carry genuine vitest output, which is the correct form. |
| evidence_integrity | minor | AC-AEP-11 | T6's own Oracle section opens with 'RED first: ... before the fix, still carry that typed gap', yet all four T6 evidence rows are result=pass. T3 and T4 both recorded expected-fail rows with non-empty tails; T6 dropped the discipline. Without a RED, nothing demonstrates the AC-AEP-11/12 tests would have failed against the pre-T6 code, so the tests are unproven as discriminating. |
| evidence_integrity | minor | — | T5 row [6] records `bun run test:changed` as result=fail (1008 pass / 1 fail) with an explanation that the failure is pre-existing and already fixed on main at c61d688. That claim is plausible and specific, but nothing in the provided materials corroborates c61d688 or that the failing file is untouched by this diff, and no post-merge green re-run of the full changed-test set is recorded. |
| scope_fidelity | minor | AC-AEP-10 | buildAssessPromptV7 is a byte-identical duplicate wrapper of buildAssessPromptV6 — same signature, same delegation, same renderer. Two exported names for one behaviour in a module whose stated lesson is that a shared symbol drifting between versions caused the original defect; the JSDoc explaining why both exist is longer than either function body. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a follow-up task that either freezes ASSESS_TEMPLATES[5] against a pre-a639485 renderer (mirroring buildAssessPromptV6Frozen) or removes key 5 from the registry, and extend the AC-AEP-9 freeze test to cover getAssessTemplate(5). | v5 currently violates the same prompt_version reproducibility invariant T5 was created to restore, and the registry doc asserts it is frozen when it is not. |
| spec | Restate AC-AEP-2 in terms production actually measures — e.g. 'the rendered evidence block for a 10-row task stays under N chars' — and drop the truncated[] clause, which cannot be affected by evidence projection. | An AC whose premise is unreachable turns a green test into a false signal that the mechanism was verified against production behaviour. |
| process | Require a non-empty expected-fail (RED) evidence row per new AC before a task may be archived, and reject output_tail values that are prose summaries rather than captured command output. | T6 archived with zero RED rows, and a third of T3's rows substituted narrative for raw output — both weaken exactly the evidence trail this spec is about. |

## Unverifiable Materials

- assess-absence-suppression.test.ts AC-AEP-11/AC-AEP-12 test bodies: Omitted from the diff for budget (present but unseen). Only the T4-era 8-test version is shown, so the 'no clean verdict' and grounded-absence control assertions were judged from the AC text and pass…
- assess-prompt-version-freeze.test.ts pinned v6 literal: Omitted for budget. Whether the frozen string was captured from a639485^ as T5 instructs, rather than from current output, could not be confirmed.
- main commit c61d688 and the pre-existing cli-evidence-result-rendering failure: Cited in T5 row [6] to explain the only failing oracle run; no corroborating artifact appears in the provided materials.

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.29
