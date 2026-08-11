---
id: KN-308
type: knowledge
role: knowledge
title: "Grepping the defect's shape finds it in the callee and misses every caller — one class, three escapes"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-117
links:
  - {id: KN-310, type: relates-to}
---
# Grepping the defect's SHAPE finds it in the callee and misses it in every caller — the same class escaped three times

Measured 2026-07-31, second independent review of the `lore setup` symlink fix. Companion to `knowledge-a-wrong-rationale-survives-self-review-better-than-a`, which recorded round one.

## The escape sequence

The defect class is "a presence check that follows symlinks, then a recursive delete".

1. **Round-zero fix** patched `RealSetupFsWriter.remove` — the entry point the incident came through.
2. **Round one (reviewer)** found `removeProjectPath`, the sync twin 100 lines below in the same file. Same shape, same file.
3. **My own follow-up** then ran what I believed was the exhaustive sweep, and wrote the discipline down as a standing lesson: *grep the SHAPE, not the symbol*. That grep returned exactly one file and I reported "no third instance".
4. **Round two (reviewer)** found `setup-project-flow.ts:625` — a live path deleting through a developer's symlink on an ordinary `lore setup --project` re-run, reproduced against a real filesystem.

## Root cause: the shape and the omission live in different files

By the time of step 3 the defect no longer HAD the original shape anywhere. Both implementations had been fixed; protection became **opt-in per call site** via a `boundary` argument. So the residual defect was not `existsSync` + `rmSync` in a callee — it was **a caller not passing an argument**. Grepping for the shape searches the wrong file by construction: the callee is already correct, and the caller contains no distinctive token at all. "No third instance" was true of the shape and false of the class.

The generalization: **when a fix converts a defect into "protected only if the caller opts in", the defect relocates from the implementation to the call graph.** Every enumeration after that point must be over CONSUMERS, not over the shape. My sweep was the right discipline applied one refactor too late.

Compounding it: the call-site pin I added scanned a hardcoded list of source files — the ones I remembered the fix touching. A pin whose coverage is a memorized file list inherits exactly the blind spot it exists to remove. It now scans three files, which is better and still not a mechanism; the real fix would be to make `boundary` non-optional so the type system enumerates the call sites, at the cost of every test double having to supply it.

**Mechanization.** After any fix that introduces an opt-in guard parameter, enumerate by grepping the CALL (`\.remove\(`, `fs\.remove\(`, the bound method name) across the whole package and stating the hit count — and prefer making the parameter required so the compiler does the enumeration instead of a regex.

## Three smaller findings from the same round

- **A gate that fails open needs its wiring asserted.** Claude Code treats a hook exiting 1 as non-blocking, and BOTH a missing file (`MODULE_NOT_FOUND`) and a syntax error exit 1 — measured. So a deleted or corrupted gate silently reverts to no enforcement, leaving only a transcript line. This repo pinned the settings.json wiring of the g1-g3 gates and pinned nothing for the new one, whose entire enforcement is one hand-written config line (it is deliberately excluded from `lore setup`'s auto-registration). The registration itself is now an AC, parsed rather than grepped, with a control on a sibling gate.
- **"Silently skips the check" is a worse failure shape than "the check fails".** `findSymlinkAncestor` returned `null` when the target did not resolve inside its boundary — dropping the protection at precisely the moment the arguments stopped making sense. Review proved it reachable on a case-insensitive filesystem (macOS APFS default) where a boundary differing only in case defeats a `startsWith` prefix test. No live call site could hit it, but the primitive's failure mode was wrong regardless: it now throws.
- **A test count hardcoded in AC prose drifts silently.** Two ACs claimed "12 passing tests" and "19 tests"; the suites had grown to 19 and 23. `lore verify`'s oracle checks exit code and under-match, never a numeral in prose, so nothing caught it. Both ACs now assert zero failures and enumerate post-conditions instead of a count — the count belongs in the run output, not in a sentence that ages.

## Calibration

Two independent review rounds on one change set found, in order: a same-file twin, a missing timeout, a leaked git pseudo-ref, a fourth call site, a fail-open wiring gap, a case-sensitivity hole, and two drifted AC counts. Self-review had caught the first two before round one returned and none of the rest. The pattern across both rounds is consistent: **self-review re-checks what it thought about, and re-reads its own conclusions rather than re-deriving them.** Independent review is not a formality on a change set that has already been carefully verified — on this one it was the only thing that found the live data-loss path.
