---
id: TASK-434
type: task
role: plan
title: "Literal NUL bytes in two scripts source files: one is already unreviewable-binary to git, the other is a latent bomb past the 8000-byte sniff window"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
Regression introduced 2026-08-01 by `a2f3fe9` (merged as `d6b87a9`, the test-budget ledger
title-fingerprint re-key). Found during orchestrator merge-verification, NOT by any oracle —
every declared oracle passed (43/43 vitest, `check-test-budgets` exit 0, `tsc` exit 0).

## What was measured

`git show --stat a2f3fe9` renders one file as `Bin 0 -> 6331 bytes`:
`scripts/migrate-test-budget-ledger-to-title-fingerprint.ts`. A `.ts` source file reported as
BINARY. Byte scan of both new/changed scripts:

| File | raw NUL bytes | offsets | git calls it binary? |
|---|---|---|---|
| `scripts/migrate-test-budget-ledger-to-title-fingerprint.ts` | 4 | 5119, 5129, 5318, 5332 | **YES** |
| `scripts/check-test-budgets.ts` | 4 | 22821, 23127, 23240, 23260 | no (yet) |

At `f3242aa` (immediately before the task) `scripts/check-test-budgets.ts` held **0** NUL
bytes. Both sets are new.

The NULs are DELIBERATE and the intent is sound — a map-key separator that cannot occur in a
path or a test title:

    for (const v of violations) byOldKey.set(`${v.file}\0${v.line}\0${v.spawnCount}`, v);

The defect is purely that they were written as **literal NUL bytes in the source** instead of
the escape sequence `\0` / `\u0000`.

## Why this is not cosmetic

1. git's binary heuristic sniffs only the **first 8000 bytes**. The migrate script is 6331
   bytes total, so its NULs land inside the window and git flags the whole file binary — it
   produces no diff and cannot be reviewed, in a repo whose entire review discipline is
   diff-based.
2. `scripts/check-test-budgets.ts` (54735 bytes) escapes detection ONLY because its NULs sit
   at offset ~22821, past the window. **It is a latent bomb**: any future edit that shortens
   the file above them, or moves that code earlier, silently flips the repo's own test-budget
   oracle to unreviewable-binary.
3. That "a property depends on a byte offset set by unrelated edits" shape is EXACTLY the
   fragility class the very commit that introduced it was fixing. Worth noting explicitly in
   the fix.

## Required

- Replace every literal NUL byte in both files with an explicit escape. Prefer a single named
  constant over a bare `\0` at each site, so the intent is documented and cannot be
  re-introduced as a raw byte by a later edit:

      /** Composite-map-key separator. A NUL can never occur in a path or a test title, so it
       *  cannot collide with content. MUST stay an ESCAPE, never a raw byte — a raw NUL inside
       *  git's first-8000-byte sniff window makes the whole file binary and unreviewable. */
      const KEY_SEP = "\u0000";

- ⛔ Fix at the MECHANISM ROOT, not by cleaning these two files: add a repo-level guard that
  fails when any tracked TEXT source file contains a raw NUL byte. Without it the class
  recurs the next time an agent types a NUL into a template literal. Decide where it belongs
  (a `scripts/` check wired into the pre-push gate alongside `lore status --check-tree`, or a
  test) and justify the choice. Make it enumerate offenders with byte offsets, not just count
  them.
- Verify the guard FAILS on demand: introduce a raw NUL into a scratch file, confirm the guard
  reds and names it, then remove it. An oracle that has not been made to fail has not been
  demonstrated.
- Confirm `git show --stat` / `git diff` renders BOTH files as text after the fix (that is the
  actual user-visible symptom — assert it, do not assume it follows from the byte count).

## Oracle

- the new guard, run against the real tree → exit 0, plus its deliberate-failure control going red
- `git diff --numstat` on both files shows real line counts, never `-  -` (the binary marker)
- `bun run scripts/check-test-budgets.ts` → exit 0 (unchanged behaviour; the key separator is
  semantically identical, so this is a REGRESSION check that the escape swap changed nothing)
- `bunx vitest run scripts/tests/check-test-budgets.test.ts` → exit 0
- `bun run typecheck` → exit 0

## Note on how this escaped

No declared oracle covers "is a source file reviewable". The task's own six-dimension coverage
was about ledger matching semantics and was met. This is a reminder that oracle sets are a
floor, not a ceiling — the finding came from reading `git show --stat` output during
merge-verify, which is not automated anywhere.
