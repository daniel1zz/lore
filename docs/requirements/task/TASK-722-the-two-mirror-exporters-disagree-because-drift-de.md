---
id: TASK-722
type: task
role: plan
title: "The two mirror exporters disagree because drift detection is body-only: no invocable command can repair a status-only drift, yet the suite rewrites it mid-run"
status: draft
priority: critical
phase: "readonly-oracle"
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PLAN-124
plan: PLAN-124
---
Adopts the two filed reports 01KZVAXZQAT4S9F4HGQT45YTT9 and 01KZWF5EFFNWW673QYEEPNCMVT,
which have no plan and therefore no owner. Measured end to end on main 2026-08-13 —
mechanism, not symptom:

## 1. The routine exporter is structurally incapable of repairing content drift

`scripts/export-spec-mirror.ts::main()` reads ONLY `--check` from argv; `runExport` never
passes `ExportDocsOptions.force`; `ExportDocsService` overwrites a drifted file ONLY under
`force: true`. So `bun run mirror:export` prints `⚠ drift: <path>` and `overwritten 0` and
exits 0, leaving the file untouched. Measured: 31 drifted files across all six types,
`git status` empty afterwards.

## 2. The drift detector never compares frontmatter, so `--force` does not help either

`export-docs-service.ts` compares `canonicaliseBody(extractBodyFromMd(fileMd))` against
`canonicaliseBody(resolvedBody)` — body only. Its own comment at line 499 says the check is
"blind to frontmatter by design". Frontmatter is regenerated only via three IDENTITY
signals (reconciled mapping / on-disk `id:` mismatch / stale refs); a `status` transition
trips none of them. Because `--force` only rewrites files the body-only detector already
flagged, `lore export-docs --force` cannot fix a status-only drift either.

Measured: after SPEC-142 went draft -> approved and TASK-718 went draft -> archived, BOTH
exporters reported clean (`1482 files already match corpus`, `drift 0` on all six types)
while both mirror files still read `status: draft`.

## 3. `check:spec-mirror` cannot see it either

It compares count and slug parity only — its own OK line says `file CONTENT is not
compared`. So all three commands agree the mirror is fine while it is materially wrong.

## 4. The suite's exporter DOES write frontmatter — and that contradicts AC-OX-1

`bun run test:bun` rewrote exactly the SPEC-142 line the routine exporters had just
refused, dirtying the tree mid-run and tripping `assertRepoCorpusClean` in
`spec-loop-e2e.bun.test.ts`. AC-OX-1 of this spec asserts "No test invokes the mirror
exporter in WRITE mode anywhere under scripts/tests or packages/lore/tests" — that write
happened anyway, so either the AC's oracle does not reach the path that performed it or
the write comes from a surface the AC does not enumerate. ⛔ Determine which BEFORE fixing
anything: an AC that is green while the behaviour it forbids is observable is the more
serious of the two defects here.

## Consequence to fix, stated as a falsifiable outcome

A status-only corpus change currently CANNOT be pre-cleaned by the documented "re-export
and commit before the run" remedy, because no invocable command will write it — only the
suite will. That is why the remedy is unreachable, and why every archived task still reads
`status: draft` in the mirror.

⛔ Do NOT fix this by teaching the suite's exporter to stop writing while leaving the
routine exporter blind — that would make the mirror permanently unfixable rather than
fixable-only-by-accident. The two exporters must converge on ONE behaviour, and the drift
report must name what it cannot repair rather than printing OK.
