---
id: KN-233
type: knowledge
role: knowledge
title: "Merge-verify must read the diff's SHAPE, not just re-run the oracles: two defects shipped past a fully green oracle set, and a selector's UNIVERSE is part of its contract"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: TASK-433, type: relates-to}
  - {id: ADR-027, type: relates-to}
  - {id: KN-260, type: relates-to}
---
Session 2026-08-01, resuming `knowledge-handoff-agent-main-orchestrator-58`. Four tasks landed
(`ca4ccbc`, `d6b87a9`, `7f02c1f`, `7463a62`). Three of the findings below were produced by the
session, not planned by it — they are the transferable part.

## 1. The oracle set is a floor, and this time the floor was measurably below the defects

Two real defects shipped past a FULLY GREEN oracle set. For
`task-key-test-budget-ledger-rows-on-a-test-title-fingerprint` the implementer reported, and the
orchestrator independently reproduced: 43/43 vitest, `check-test-budgets` exit 0, `tsc` exit 0.
Both defects were found by **reading `git show --stat` output during merge-verification** — a step
no oracle performs:

- one file rendered `Bin 0 -> 6331 bytes` (a `.ts` source git had classified as binary)
- the diff stat's file list revealed the second when cross-checked against the declared anchors

Neither is exotic. Neither was in any AC. The lesson is not "add these two checks" — it is that
**merge-verify must include reading the shape of the diff, not only re-running the named oracles.**
An orchestrator that only re-runs the implementer's commands is a slower copy of the implementer.

## 2. A raw NUL byte in source is position-dependent poison, and content-only fixes cannot undo it

Measured, not inferred:

- Three tracked files carried literal NUL bytes as composite-map-key separators
  (`` `${a}\0${b}` `` typed as a raw byte instead of the escape). Intent sound, encoding wrong.
- git's binary heuristic sniffs roughly the **first 8000 bytes**. `migrate-test-budget-ledger-to-title-fingerprint.ts`
  (6331 bytes) had its NULs at offset 5119 → **inside** the window → whole file binary, no diff,
  unreviewable. `check-test-budgets.ts` (54735 bytes) had NULs at offset 22821 → **outside** the
  window → undetected. `packages/lore/src/store/in-memory-store.ts` likewise, and had been sitting
  on main undetected.
- So whether the defect is VISIBLE depends on a byte offset that unrelated edits move. Any future
  edit shortening a file above its NULs silently flips it to unreviewable-binary.
- ⚠ **The non-obvious part**: fixing the content does NOT restore the diff. `git diff --numstat`,
  `--text`, and `-a` all still printed the binary marker, because git's binary check runs
  independently on **each side** of a diff and the parent commit's blob remains NUL-poisoned. Only
  the `diff` gitattribute (per `gitattributes(5)`: "treated as text, even when they contain byte
  values that normally never appear in text files, such as NUL") fixes it. Note `text` is a
  DIFFERENT attribute governing line-ending conversion — setting it would have been wrong.
- Mechanized: `scripts/check-no-nul-bytes.ts` (+ `scripts/tests/check-no-nul-bytes.test.ts`) scans
  every `git ls-files`-tracked text-source file and names offenders with byte offsets. It found the
  third file on its first real-tree run. Deliberately NOT wired into `hooks/pre-push`: that hook is
  corpus-specific and fails OPEN when `.lore`/`lore` is absent, which would make the scan silently
  inert on a fresh clone.

Note the self-similarity: this is the SAME "a property depends on a byte offset set by unrelated
edits" fault as the `(path, line)` ledger key that the very same commit was fixing.

## 3. A selector blind spot let a FOREIGN session walk new debt into main — measured in both directions inside 24h

The strongest evidence produced this session, because both ends were observed:

- `bun run test:changed`'s file universe was `packages/**`. The entire `scripts/` tier — including
  `scripts/tests/check-test-budgets.test.ts`, the test that asserts the test-budget oracle exits 0 —
  was invisible even to rule (a), plain changed-test-file selection. Reproduced on the identical
  base `f3242aa`: `vitest: selected 1`, grep count for that test file = **0**.
- Meanwhile another session, branched from that same `f3242aa`, added 8 spawn-heavy assess test cases
  with no declared timeouts. Its scoped oracle could not select the test that would have caught it, so
  it merged a confident green. `check-test-budgets` on main then exited 2 with 8 new violations.
- The fix (`7f02c1f`) widened the universe. Re-measured on the SAME base: `vitest: selected 4`,
  including both `scripts/tests/*.test.ts` files, reason `changed-test`.

So the escape and the fix happened hours apart in opposite directions. The generalizable rule:
**a scoped-selection oracle's UNIVERSE is part of its contract.** "0 selected, exit 0" is
indistinguishable from "passed" at the call site, and a universe that excludes the directory holding
the repo's own gates makes the gate-guarding tests the least-covered code in the tree.

## 4. Attribution before accusation paid off twice

- The 8 new violations looked like a cross-session interaction with this session's ledger re-key.
  Checked: `98fc22b`'s parent is `f3242aa`, the re-key (`d6b87a9`) is NOT its ancestor, and it touched
  neither the ledger nor the oracle. Genuinely their own new debt — the re-key was innocent.
- `knowledge-handoff-agent-main-orchestrator-58`'s NS4/NS5 were both ALREADY resolved at read time,
  each confirmed by two independent facts (a commit being an ancestor of main AND a fresh regen
  producing zero diff; the named worktrees no longer existing). Second consecutive ticket where
  re-verifying beat building — the standing lesson holds.

## 5. Discriminating checks, not bare greens — the method that made the above verifiable

Every merge-verify this session used a check that could only pass under the new behaviour, rather
than a check that merely passed:

- widened predicate: asserted `verify.test.ts` is selected **with reason `binary-consumer`**, which
  for a vitest `.test.ts` spawning `INDEX_TS` is unreachable under the old predicate
- ledger re-key: **two-sided** — corrupting a row's `line` must still exit 0 (line non-authoritative),
  corrupting its `titleFingerprint` must exit 5 loud (fingerprint authoritative). A one-sided green
  would have been satisfied by an oracle that ignored the ledger entirely.
- NUL guard: the orchestrator injected its own NUL into a tracked file and confirmed exit 1 with the
  exact offset, rather than accepting the agent's report that it had done so
- selector universe: before/after on the IDENTICAL base, both measurements taken by the orchestrator

A bare green is compatible with the oracle being inert. A discriminating check is not.

## 6. Honest evidence beats a clean-looking task

`task-literal-nul-bytes-in-two-scripts-source-files-one-is` was archived with an `expected-fail`
evidence row recording that its `check-test-budgets` regression check was **blocked, not passed**,
naming the foreign commits responsible and the fact that the task's own files contribute zero
violations. Recording a `pass` there would have been fabrication; omitting it would have left the
next session to rediscover a red main. `expected-fail` exists for exactly this.

Related: all 9 evidence rows on the first task archived this session were `attested=false`. An
`--adhoc` task with no declared AC gives `lore verify` nothing to run, so attestation is structurally
unobtainable for it — which is why
`adr-lore-done-requires-a-runner-attested-pass-the-sixth-false` pairs its read-side gate with an
audited escape hatch. That escape is load-bearing, not defensive.
