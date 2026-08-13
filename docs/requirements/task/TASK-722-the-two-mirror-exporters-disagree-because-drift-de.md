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

## 4. RESOLVED 2026-08-13 — the AC's oracle was NOT blind; "mid-run" meant a different run

⚠️ This section previously posed a two-way question ("either the AC's oracle does not
reach the path that performed it, or the write comes from a surface the AC does not
enumerate") and instructed the implementer to determine which BEFORE fixing anything.
**Both branches were wrong**, and the question is now closed by measurement — do not
re-open it or spend budget re-investigating.

The write came from exactly the call the AC names: `runMirrorScript([])` in
`scripts/tests/spec-mirror-export.test.ts`, 12 occurrences. The apparent contradiction
("`test:bun` runs only `.bun.test.ts`, so it cannot be that vitest file") dissolves at
`package.json`: `test` is `bun scripts/oracle-lock.ts sh -c "bun run test:vitest && bun
run test:bun && bun run check:spec-mirror"`. The vitest phase runs FIRST, in the same
`bun run test` invocation, and its 12 write-mode calls regenerate every mirror file's
frontmatter (`export-docs-service.ts` writes `status: ${doc.status}` on every export).
By the time `test:bun`'s `assertRepoCorpusClean("before")` ran moments later, the dirt
from the preceding phase was already on disk. "Mid-run" meant mid the overall run, not
mid `test:bun`. Every `.bun.test.ts` file touching mirror/export-docs was read and each
one isolates to an `mkdtemp` throwaway corpus.

AC-OX-1 was never green while its forbidden behaviour was observable — it carried ZERO
evidence and had never been evaluated (bare `·` in `lore ac list`, against
`⚑✔(n/0, 1 attested)` on AC-OX-2/3/4). So no AC needs widening, and this is ordinary
unstarted work rather than a governance emergency. The read-only conversion landed in
main as `300d9609`; AC-OX-1 is now attested FAIL at exit 1 for an unrelated reason (see §5).

## 5. What `--check` DOES catch, measured — KD4 conflated two blind spots

`bun scripts/export-spec-mirror.ts --check` exits **2** and names, per type, every corpus
doc with no mirror file at all, printing the reconcile command. So count/slug parity is
NOT blind to a missing mirror — it caught 3 such docs on 2026-08-13 and said so.

The real blind spot is narrower and must be stated precisely: a mirror file that EXISTS
but whose CONTENT disagrees with the corpus. Body drift is compared (one file flagged);
frontmatter is not (`export-docs-service.ts`, "blind to frontmatter by design"), so a
`status` transition is invisible to all three of `mirror:export --check`,
`lore export-docs --force`, and `check:spec-mirror`.

## Consequence to fix, stated as a falsifiable outcome

A status-only corpus change currently CANNOT be pre-cleaned by the documented "re-export
and commit before the run" remedy, because no invocable command will write it — only the
suite will. That is why the remedy is unreachable, and why every archived task still reads
`status: draft` in the mirror.

⛔ Do NOT fix this by teaching the suite's exporter to stop writing while leaving the
routine exporter blind — that would make the mirror permanently unfixable rather than
fixable-only-by-accident. The two exporters must converge on ONE behaviour, and the drift
report must name what it cannot repair rather than printing OK.
