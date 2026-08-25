---
id: TASK-846
type: task
role: plan
title: "A narrowed export must never delete another type's mirror: put a refusal behind the prune-scoping pairing"
status: approved
priority: medium
phase: "command surfaces"
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-148
plan: PLAN-148
---
## Objective

Put a refusal behind the one pairing that keeps a narrowed export from deleting five sixths of
the mirror. Closes AC-MOS-6.

## The hazard, in the code as it stands

`runExport` in `scripts/export-spec-mirror.ts` ends with:

```ts
const pruned = pruneOrphanMirrorFiles(repoRoot, liveMappings, types.map(mirrorDirRelative));
```

⛔ Both arguments are narrowed by the SAME `types` list, and that pairing is the ONLY thing making
a narrowed export safe. Narrow `liveMappings` alone and the remaining five directories get swept
against a doc list that never contained them — every file in each is deleted as an "orphan".
That is 1800+ files, it is unrecoverable from the run itself, and it renders in the log as a
deliberate prune.

Today that pairing is held by a code comment. Nothing refuses its violation. This task is the
refusal.

## What to build

`scripts/tests/export-spec-mirror-narrowed-prune-scope.test.ts`, asserting AC-MOS-6's three
conjuncts in ONE run. Read the criterion verbatim first — it is the authority:
```
lore ac list spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by
```

⛔ **This is a DESTRUCTIVE path.** Every write goes to a `mkdtemp` + `lore init` throwaway with
`HOME` redirected inside it. ⛔ NEVER this repo's `docs/requirements` — a real-tree run of the
failure mode is not recoverable, and `scripts/tests/spec-mirror-export.test.ts` was rewritten
days ago specifically to stop mutating the real tree. Read its sandboxing pattern and follow it.

⛔ Conjunct (a) is PER-DIRECTORY equality, never an aggregate total: a total stays equal when one
directory loses a file and another gains one.
⛔ Conjunct (c) is the non-vacuity guard and is not optional — without it, a prune that deletes
nothing at all satisfies (a) and (b) perfectly.

## ⛔ The recorded red is the deliverable

Red-on-arrival is only "the file does not exist". After the suite is green, in a scratch copy of
`scripts/export-spec-mirror.ts` that you revert, apply the EXACT asymmetry the criterion names —
pass `MIRROR_TYPES.map(mirrorDirRelative)` as the third argument while `liveMappings` stays
narrowed — and confirm the run goes RED on (a) and (b) while (c) STILL PASSES. ⛔ That last part
matters: if (c) also fails, your control is entangled with the thing it controls and the failure
is not attributable. Record at the moment observed:

```
lore evidence task-<slug> --oracle test --ac AC-MOS-6 --command "<exact cmd>" --result expected-fail --output-tail-file <file>
```
⛔ Measured on the previous task: the flag is `--ac` (not `--ac-ref`), and an `expected-fail` row
is REFUSED without `--output-tail` / `--output-tail-file`.

Then restore, and confirm with `git diff` that your only tracked change is the new test file.

For the GREEN use `lore verify … --allow-new-commands` (measured: a never-run AC command exits 7
without it):
```
lore verify plan-land-the-two-mirror-command-surfaces-one-row-contract-for --task <slug> --allow-new-commands
```

## Context

- `MIRROR_USAGE_EXIT_CODE = 3` is exported from `scripts/export-spec-mirror.ts`; `MIRROR_DRIFT_EXIT_CODE`
  and the other codes live in `scripts/export-spec-mirror-core.ts`. ⛔ Measured on the previous
  task: a vitest worker CANNOT import `scripts/export-spec-mirror.ts` (it transitively pulls
  `bun:sqlite` via `app.ts`). The sibling suites read exported constants by importing them inside
  a `bun -e` subprocess — reuse that shape rather than rediscovering the failure.
- `--type` narrows BOTH modes, check and export. The export half is the one with no coverage; that
  is precisely what you are closing.

## Finish

Scoped: the AC-MOS-6 command, `bun run typecheck`. ⛔ `bun run test:changed` reports
`build-first: yes` on this tree — do NOT run it; hand-pick instead and say what you ran. At
minimum re-run `scripts/tests/export-spec-mirror-type-scope.test.ts` and
`packages/lore/tests/integration/mirror-check-read-only.bun.test.ts` (the direct `runExport`
consumer, under `bun test`).
⛔ Do NOT run the full suite, `lore done`, `bun run build`, or `bun run mirror:export`.
Commit with the task slug → `lore release`.
