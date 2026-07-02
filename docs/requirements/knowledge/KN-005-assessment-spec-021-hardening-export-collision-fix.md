---
id: KN-005
type: knowledge
role: knowledge
title: "Assessment: SPEC-021 hardening — export collision fixes (2026-07-02)"
status: draft
priority: medium
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-005
links:
  - {id: PLAN-005, type: informs}
---
# Assessment: partially_met (63/100)

Scope: plan `01KWHBEYA1SBD4S5GDCV5TDE3M`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-EXPORT-1 | 55 | No diff shown; evidence mentions full export-docs clean on real corpus, implying per-doc file emission works, but not directly demonstrated here. | task-fix-export-human-id-file-path-collision-repair-index (real corpus follow-up export fully clean) |
| AC-EXPORT-2 | 50 | Index existence/creation not directly evidenced; only index repair (KN-003 reallocation) shown. Conservative. | task-fix-export-human-id-file-path-collision-repair-index |
| AC-EXPORT-3 | 55 | Idempotency claimed: 'follow-up export fully clean/idempotent' on real corpus. No test file/diff to confirm. | task-fix-export-human-id-file-path-collision-repair-index (idempotent) |
| AC-EXPORT-4 | 45 | Roundtrip parity not directly evidenced in this hardening scope; broad test pass noted but no explicit roundtrip result. | task-regression-tests-for-export-collisions |
| AC-EXPORT-5 | 60 | Second doc getting distinct new file+entry (KN-003) directly demonstrated via real-corpus reallocation; grows-by-one not explicitly counted. | task-fix-export-human-id-file-path-collision-repair-index (01KWHB786ZMZ reallocated KN-003 + file written) |
| AC-EXPORT-6 | 50 | Parent human-ID resolution untouched by collision fix; no direct evidence here. Conservative. | — |
| AC-EXPORT-7 | 45 | --dry-run parity not evidenced in provided materials. | — |
| AC-EXPORT-8 | 50 | Type filter tested per plan file-touch list mention but no direct evidence in this hardening run. | — |
| AC-EXPORT-9 | 48 | Drift warning behavior not directly exercised here; broad suite passes only. | task-regression-tests-for-export-collisions |
| AC-EXPORT-10 | 45 | Soft-delete skip not evidenced in provided materials. | — |
| AC-EXPORT-CORE-1 | 55 | Index Zod schema validation implied by index repair but not directly evidenced; no diff. | — |
| AC-EXPORT-COLLISION-1 | 78 | Core target of plan: allocator + path dedupe fixed, duplicate-title docs get distinct human_ids+paths, self-heal both branches + 999-exhaustion tested, incident repro included, real-corpus repair verified. No diff to confirm O_EXCL mechanism. | task-regression-tests-for-export-collisions (10 new collision tests, both self-heal branches, 999-exhaustion, 0 impl bugs), task-fix-export-human-id-file-path-collision-repair-index (tsc pass, vitest 1788/bun 521, real corpus self-heal) |

## Gaps

- No diff provided — implementation of allocator/path-dedupe and O_EXCL collision retry mechanism cannot be directly verified.
- Most AC-EXPORT-1..10 are only indirectly supported by a single 'full clean export' claim, not per-AC evidence.
- No explicit evidence for dry-run parity, parent human-ID resolution, soft-delete skip, or roundtrip 0/0 result in this hardening pass.
- Index growth 'by exactly one' (AC-EXPORT-5) claimed via reallocation but not counted explicitly.

## Recommendations

- Attach the export-docs-service.ts diff and the new collision test file so allocator/path-dedupe and O_EXCL retry can be independently verified.
- Include explicit per-AC oracle output (dry-run parity, roundtrip 0/0, index-entry count) rather than a single aggregate 'export fully clean'.
- Document the migration/manual reconcile step for the corrupted 01KWHB786ZMZ entry as a repeatable, tested procedure.
- Add a regression assertion that index entry count grows by exactly one on a new corpus-only doc (AC-EXPORT-5).

## Judgment

- Provider: claude-cli
- Prompt version: 1
- Duration: 78296ms
- Retried: true
- Truncated sections: spec
