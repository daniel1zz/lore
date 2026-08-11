---
id: KN-380
type: knowledge
role: knowledge
title: "SPEC-104 fallout: changed-tests.ts porcelain-path bug + cli-utils.test.ts worktree-cwd fragility"
status: draft
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-107
---
## Two findings from implementing SPEC-104 (worktree-derived actor identity)

### 1. `scripts/changed-tests.ts` porcelain-path parser bug (out of T1's file anchors)

`getChangedFiles()` pipes `git status --porcelain --untracked-files=all` through
`.split("\n").map(l => l.trim())` BEFORE calling `parsePorcelainPath(line)`, which does
`line.slice(3)` assuming the UNTRIMMED 3-char status-prefix format (` M path`). `.trim()`
strips the leading space of any ` M`/` D`/` A` (modified-in-worktree, not staged) line,
shifting the fixed offset by one and truncating the path's first character (e.g.
`packages/lore/src/adapters/cli/utils.ts` becomes `ackages/lore/src/adapters/cli/utils.ts`).
The corrupted path misses `fileMap.has()` and is silently dropped from the changed-set —
no error, no WARNING (`zeroSelectionWarning` only fires when `selected.length===0`; other
correctly-parsed files — e.g. untracked `??` files, which have no leading space to trim —
still get selected, masking the drop). Untracked (`??`) files are unaffected.

Net effect: `bun run test:changed` silently under-selects reverse-dependent tests for
every MODIFIED (not newly-added) source file. Discovered while verifying SPEC-104: both
`utils.ts` and `claim.ts` were modified, and `test:changed <base> --list` reported
"vitest: selected 0" when the correct transitive closure (verified via a direct
`selectAffectedTests()` invocation with a manually-corrected changed-file list) is ~37
vitest files + ~15 bun files.

Fix: reorder — `slice(3)` BEFORE `.trim()` in `parsePorcelainPath`'s caller, or trim only
after slicing, or slice on the untrimmed line directly.

### 2. Bare `resolveActorWithSource`/`resolveActor` calls in 2 pre-existing test files are
now worktree-cwd-fragile

SPEC-104 makes `resolveActorWithSource`'s default `cwd` (= `process.cwd()`) load-bearing:
when cwd sits inside ANY linked git worktree with a resolvable branch HEAD, resolution now
correctly derives `agent:<branch>` instead of falling to the OS username — exactly the
intended, spec'd behavior (SPEC-104 Behavior table, D1-D4). Two PRE-EXISTING test files
call the function with no `cwd` override and are therefore now ambient-cwd-dependent:

- `packages/lore/tests/unit/adapters/cli-utils.test.ts` — 6 assertions across
  `resolveActorWithSource > HAPPY/BOUNDARY/STATE` and the
  `resolveActor — OS-fallback advisory side effect (AC-AUDIT-ACTOR-1)` describe block.
- `packages/lore/tests/unit/cli/actor-session-tier.test.ts` — 8 assertions across its
  HAPPY/BOUNDARY/NEGATIVE/ERROR os-fallback-tier cases (this file's own header already
  documents it passes literal env objects with ZERO `process.env` mutation for exactly
  this env-pollution-hazard reason — it did not anticipate cwd becoming load-bearing too).

Total: 14 failing assertions across these 2 files (confirmed via
`bunx vitest run <both files> --reporter=verbose`), ALL with the identical signature:
expected `{actor: "<OS username>", source: "os-fallback"}`, received
`{actor: "agent:actor-derive", source: "worktree-derived"}` (or the stderr-advisory
equivalent) — i.e. every failure is the SAME root cause, not 2 independent issues.

Consequence: these tests PASS when the vitest process's cwd is the MAIN checkout
(`.git` is a directory there) but FAIL when it's a LINKED worktree (`.git` is a file) —
which is THIS TEAM'S OWN standard subagent-dispatch pattern (every implementer works
inside a linked worktree, per the project's worktree-dispatch protocol). Verified by
running the same suite from inside `../lore-worktrees/actor-derive` (a linked worktree)
and observing exactly these 14 assertions flip — confirming the root cause is ambient
cwd, not a defect in the SPEC-104 implementation itself (AC-ACTOR-3's "byte-identical in
the MAIN checkout" contract is separately verified GREEN via
`actor-worktree-derivation.bun.test.ts`'s own isolated `mainRepo` fixture, which never
relies on ambient cwd).

This is a landmine for every FUTURE worktree-dispatched implementer who happens to touch
either file's neighborhood and runs a broader vitest sweep from inside their own
worktree — they will see 14 unrelated failing assertions with no connection to their own
change.

Fix (needs a follow-up task; NOT done here — out of T1's declared file anchors, `utils.ts`
+ `commands/claim.ts` + the new bun test file only): the affected assertions in both files
need to pass an explicit non-worktree `cwd` (e.g. `os.tmpdir()`) using the optional 3rd
param T1 added to `resolveActorWithSource(explicit?, env?, cwd?)` /
`resolveActorWithIdentitySource(explicit?, env?, cwd?)` — and `resolveActor` would need the
same optional `cwd` param added (T1 left `resolveActor` at 1 param; only
`resolveActorWithSource`/`resolveActorWithIdentitySource` gained the seam) to let
`cli-utils.test.ts`'s `resolveActor(undefined)` call sites compile against an override.

Full failing-assertion list (vitest, run from `../lore-worktrees/actor-derive`):
- cli-utils.test.ts > resolveActorWithSource > HAPPY > returns {source: os-fallback, actor: OS username} when neither is provided
- cli-utils.test.ts > resolveActorWithSource > BOUNDARY > treats a whitespace-only $LORE_ACTOR as absent, falling through to OS username
- cli-utils.test.ts > resolveActorWithSource > STATE — $LORE_ACTOR set/unset within the test > falls back to OS username once $LORE_ACTOR is deleted mid-test
- cli-utils.test.ts > resolveActor — OS-fallback advisory side effect (AC-AUDIT-ACTOR-1) > OS-fallback (no --by, no $LORE_ACTOR) emits exactly 1 stderr line matching /OS username/
- cli-utils.test.ts > resolveActor — OS-fallback advisory side effect (AC-AUDIT-ACTOR-1) > once-per-process guard: a SECOND OS-fallback call in the same process writes 0 additional lines
- cli-utils.test.ts > resolveActor — OS-fallback advisory side effect (AC-AUDIT-ACTOR-1) > the guard resets when resetActorFallbackWarningForTests() is called (test-only escape)
- actor-session-tier.test.ts > HAPPY > falls through to os-fallback when neither --by, $LORE_ACTOR, nor any session var is set
- actor-session-tier.test.ts > BOUNDARY > a whitespace-only session id falls through to os-fallback
- actor-session-tier.test.ts > BOUNDARY > an empty-string session id falls through to os-fallback
- actor-session-tier.test.ts > BOUNDARY > a non-whitespace session id that sanitizes to empty ("---") falls through to os-fallback without throwing
- actor-session-tier.test.ts > BOUNDARY > a non-whitespace session id that sanitizes to empty ("!!!") falls through to os-fallback without throwing
- actor-session-tier.test.ts > BOUNDARY > the CLAUDE_SESSION_ID alias also degrades to os-fallback on a sanitize-to-empty value, not a throw
- actor-session-tier.test.ts > NEGATIVE > an env object with unrelated keys only still falls through to os-fallback
- actor-session-tier.test.ts > ERROR > a sanitize-to-empty CLAUDE_CODE_SESSION_ID ("---") degrades to os-fallback AND still emits the OS-fallback stderr advisory, without throwing
