---
id: TASK-317
type: task
role: plan
title: "Unify mirror identifiers on zero-padded form, export all six doc types, and drive links_broken to zero so the full suite goes green"
status: draft
priority: medium
phase: "mirror"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-076
plan: PLAN-076
---
⛔ **main's full suite is RED right now** — `1 failed | 493 passed`, `FULL_EXIT=1`. Your task is the
fix. `packages/lore/tests/unit/eval/migration-coverage.test.ts` fails with
`AssertionError: expected 43 to be +0` on `links_broken`.

## Root cause, already diagnosed — do not re-derive it, verify it

The inconsistency lives in the SSOT itself. From `.lore/export-index.json`:

```json
"01KWBVX30DGVDYMTK1DR2ZW8PS": {
  "human_id": "SPEC-21",                                         ← NOT padded
  "file_path": "docs/requirements/spec/SPEC-021-sync-docs-...md" ← zero-padded
}
```

Measured on the merged tree:
- 89 of 142 spec mirrors have `filename identifier != frontmatter id:` (46 padded / 97 non-padded).
- Cross-type references write the FILENAME form (`SPEC-078`) while the target file's `id:` says
  `SPEC-78` → **88 broken references**: plan 73, knowledge 14, adr 1.
- Every non-spec mirror is also stale: adr 12/30, knowledge 168/399, plan 75/120, task 316/644.
  Only spec reached parity (142/142), because only spec was in the previous task's scope.

⛔ This is NOT a defect the previous implementer introduced. `ExportDocsService` has always named
files with padding and allocated `human_id` without it; the full re-export merely widened the crack
from a few files to 89. Do not treat it as rework of someone's mistake.

## Decision already made (user, 2026-08-10) — do not relitigate

**Zero-padding to 3 digits is canonical** (`SPEC-021`, not `SPEC-21`). Filenames already use it, and
it makes lexical order match numeric order. Align `human_id` to the filename form, not the reverse.

**Export ALL six types** (`prd`, `spec`, `adr`, `knowledge`, `plan`, `task`), not just spec.

## Deliver

1. **Canonical zero-padded identifiers**, consistently in: the allocated `human_id`, the generated
   filename, and `.lore/export-index.json`. ⛔ Read `SPEC-084` (corpus-allocated ordinal identity)
   first and say in your report whether zero-padding contradicts anything it specifies — if it does,
   STOP and report rather than proceeding.
2. **Full-corpus export across all six types**, with the drift check extended to cover them.
3. **`links_broken === 0`** over `docs/requirements/` — this is what turns main green.
4. **The `all-types-parity-and-id-format` case** in `scripts/tests/spec-mirror-export.test.ts`.

## ⛔ Migration hazard — read before touching export-index.json

`.lore/export-index.json` is LIVE corpus bookkeeping in a repo with a documented
corrupted-export-numbering incident. If you rewrite `human_id` values there:
- Write atomically (temp file + rename), never in place.
- ⛔ An identifier that some doc's CONTENT already cites by the old form must not silently become
  unresolvable. Search the corpus and the mirror for citations of the old non-padded form and state
  in your report how many you found and what you did about them. "No occurrences" is a fine answer
  IF you measured it.
- The file is NOT git-tracked, so your change to it does not ship. Anything that must reach a fresh
  consumer install has to land in code or `assets/`, not in this file.

## Verification

⛔ AC-FR-10 asserts against THIS repo's PRODUCTION corpus, never a seeded fixture — that requirement
exists because the sibling AC-FR-1 went green on a self-seeded corpus while 7 of 8 checkpoints were
empty in production. A fixture-only proof does not satisfy this AC.

Record all three REDs live, each as its own `expected-fail` row:
(a) delete one exported file of any type → fails naming type and slug;
(b) rewrite one file's frontmatter `id:` to the non-padded form → fails naming that file;
(c) point one cross-type reference at a non-existent id → `links_broken` non-zero, test fails.

⛔ Finally: `bun run test` (the FULL suite, both runners) must exit 0. This task is the one exception
to the usual "scoped oracle only" rule — you are fixing a full-suite red, so you must prove the full
suite is green. Persist `$?` to a file and read it back; a backgrounded command's completion notice
reports the SHELL's exit code, not the command's.
