---
id: KN-494
type: knowledge
role: knowledge
title: "A symlinked node_modules makes the green control pass while every cross-package mutation goes invisible: runnability and observability are two properties"
status: draft
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [falsifier, scratch-worktree, false-oracle, node-modules, workspace-resolution]
parent: PRD-001
links:
  - {id: KN-497, type: relates-to}
  - {id: KN-345, type: relates-to}
  - {id: SPEC-133, type: relates-to}
  - {id: ADR-036, type: informs}
---
Measured 2026-08-23 in a probe worktree built the same way `_runFalsifier` builds
its scratch tree (`git stash create` → `git worktree add --detach`), on `main` at
`e4e91d5f`. Successor measurement to
`knowledge-the-green-control-pattern-and-its-cost-a-falsifier`, whose F2 left the
next decision open with "options measured, none chosen". This doc closes that:
the four options it listed are not the choice space, because the most obvious one
introduces a NEW false-oracle vector that the green control cannot see.

## F1 — the measurement table

Four configurations, one test file (`packages/lore/tests/unit/service/corpus-service.test.ts`,
which imports its subject by RELATIVE path and `@lore/core` by BARE specifier —
the two resolution modes that turn out to behave differently):

| scratch-tree layout | green control (unmutated) | mutation in `packages/core` (bare specifier) | mutation in `packages/lore/src` (relative) |
|---|---|---|---|
| no `node_modules` (today) | exit 1 `ERR_MODULE_NOT_FOUND` | unreachable — never runs | unreachable — never runs |
| `ln -s <main>/node_modules` | **exit 0, 77 passed** | **exit 0, 77 passed** ⛔ | exit 1, error names the scratch path |
| hybrid (see F3) | exit 0, 77 passed | exit 1, error names the scratch path | exit 1, error names the scratch path |

Every cell is a real run, not an inference. The mutation was a deliberate syntax
error (`export const __PROBE_SYNTAX_ERROR_ = = = ;`) appended to the file, so a
transform-time failure is the ONLY correct outcome for any layout that can see it.

## F2 — the naive symlink is the EIGHTH false-oracle vector

⛔ `ln -s <main>/node_modules <scratch>/node_modules` makes the green control pass
and is therefore indistinguishable, to the runner, from a correct fix. It is not
one. `node_modules/@lore/core` is a RELATIVE symlink (`../../packages/core`).
Path resolution follows the outer `node_modules` symlink first, so
`<scratch>/node_modules/@lore/core` lands on `<main>/node_modules/@lore/core` and
from there on `<MAIN>/packages/core` — the ORIGINAL checkout. Therefore:

> **Under a symlinked `node_modules`, every mutation to a workspace package is
> invisible to any consumer that imports it by bare specifier, while the green
> control reports a healthy environment.**

The failure mode is the exact inverse of the one the green control was built to
fix, and it is WORSE in one specific way: the green control is a real, working
oracle for runnability, and it stays green here. A falsifier under this layout
reports "the mutation did not make the command fail", which reads as an
indictment of a perfectly sound AC oracle. So the harm is a false accusation
against good ACs rather than a false attestation — the safe direction, but still
a verdict with no discriminating power.

⇒ Vector 8 for the catalog (`knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`),
and it generalizes past falsifiers:

> **Whenever a test harness runs against a COPY of a tree, "the harness starts"
> and "the harness observes the copy" are two independent properties. An oracle
> that establishes only the first certifies nothing about the second, and no exit
> code from a passing control can distinguish them.**

This is the same shape as `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`
(capability present ≠ capability reached), applied to the test environment
instead of to production code.

## F3 — the layout that measures correctly

Build a REAL `node_modules` directory in the scratch tree, symlink each top-level
entry of the main `node_modules` into it EXCEPT the workspace scope, then create a
real `node_modules/@lore/` whose entries point INSIDE the scratch tree:

```
<scratch>/node_modules/                        (real dir)
  <441 symlinks> -> <main>/node_modules/<each>   (third-party + dotfiles incl. .bin)
  @lore/                                       (real dir)
    core      -> <scratch>/packages/core
    lore      -> <scratch>/packages/lore
    dashboard -> <scratch>/packages/dashboard
<scratch>/packages/dashboard/node_modules -> <main>/packages/dashboard/node_modules
```

Measured on this layout: green control exit 0 (77 passed); cross-package mutation
exit 1 with the esbuild error naming
`<scratch>/packages/core/src/index.ts:82:37`; the MAIN checkout's
`git status --porcelain` empty and the mutated file byte-unchanged throughout; and
BOTH runners healthy — `bunx vitest run` 77 pass, and `bun test
tests/unit/store/sqlite-store.bun.test.ts` 94 pass / 0 fail, so the `.bun.test.ts`
population is covered too. `.bin` resolution survives (the vitest binary was
invoked through it).

Costs and limits, all measured or structural:
- No install runs, so it is fast and needs no network. It does NOT fix
  `git stash create`'s missing untracked files (cause 2 of the original defect)
  nor gitignored `dist/lore` (cause 3) — those stay green-control `inconclusive`.
- The three workspace redirects are DERIVED, never hand-listed: the set must come
  from reading the main `node_modules/@lore/` (or the workspace globs), or a
  fourth package added later silently reverts to the F2 blind spot.
- Third-party packages are SHARED with the main checkout, so a test that WRITES
  inside `node_modules` escapes isolation. No such test is known here, but AC-FR-3's
  byte-identity assertion covers only the working tree, not `node_modules`.

## F4 — `lore done`'s "attested" refusal, verified at the predicate

F3 of the predecessor doc recorded this from behavior. Verified 2026-08-23 by
reading the source: `findMissingUnfilteredTestFileRuns`
(`packages/lore/src/service/task-workflow-service.ts:937`) filters evidence on
`entry.oracle === "test" && entry.result === "pass"` and inspects NO attestation
field at all, while the refusal it feeds
(same file, ~:2940) says "no attested UNFILTERED result:pass run". The word is
false at the predicate, not merely misleading in prose. Filed as
`01M0P5ET63P3TBPP1283ZDJD21` once the defect channel had a free slot.

## F5 — two governance gaps met while doing this

1. **The git-safety-gate's assessment is cwd-blind across worktrees.** Running
   `git checkout -- packages/core/src/index.ts` with cwd INSIDE the scratch
   worktree, where that file carried a real uncommitted mutation, produced the
   assessment "the named path(s) (packages/core/src/index.ts) have NO uncommitted
   changes — nothing would be lost." It read the MAIN checkout. The gate still
   BLOCKED (it blocks this shape unconditionally), so nothing was lost — but the
   assessment line is a false statement that invites an agent to re-run the
   command in its own shell believing the path is safe. Same family as the
   already-filed `--cwd blind spot is a CLASS` defect
   (`01KZVPHGEMFYWRW3JYB8RYP8F1`).
2. **A filed defect that is genuinely FIXED keeps occupying cap quota until
   someone draws the `resolves` edge by hand.** `01M0H8XP5JZTR8Q7BH6HV6YRM4` was
   closed by an archived plan whose own body says "Closes defect
   01M0H8XP5JZTR8Q7BH6HV6YRM4", yet its computed resolution stayed `open` and the
   channel stayed write-blocked at cap, because the prose reference is not an
   edge. `lore link <plan> <issue-task> --type resolves` flipped it to `fixed` in
   one call. ⇒ A plan body naming a defect id is a candidate for an automatic
   edge, or at minimum for a `plan-close` advisory; today the only thing standing
   between "fixed" and "still blocking the channel" is an agent remembering.

## F6 — the fix works: eight attested reds, and the negative control that proves it is not saying yes to everything

Measured 2026-08-23 after the hybrid layout landed and was wired into `_runFalsifier`.
`lore verify --falsify` over all eight AC-SD criteria recorded **eight attested
reds** — each `exit 1 (declared 1) — result:expected-fail, capture_source:runner`.
Before this, the same mechanism produced 11 of 11 FALSE reds (pre-green-control)
and then 0 reds at all (post-green-control, every `oracle: test` criterion
`inconclusive`). This is the first population of genuine machine-proven reds it
has ever produced.

⛔ Eight affirmative reds do not establish discriminating power — the mechanism
could equally have learned to say yes to everything, and an affirmative run
cannot tell those apart. So a NEGATIVE control was run: one throwaway criterion
whose falsifier find-text was replaced with ITSELF (an inert mutation) and whose
declared exit code was 1. Result:

> exit 4 — `AC "AC-SD-NEG"'s declared falsifier claims exit code 1, but the
> mutated command actually exited 0 — the declaration does not match reality.
> Nothing recorded.`

Correct refusal. The mechanism discriminates in both directions.

## F7 — a refused falsify run records NOTHING, so the control that proves discriminating power is structurally unprovable from the corpus

⛔ This is F6's sting, and `lore assess` scored it a MAJOR on `evidence_integrity`
— correctly, and no oracle caught it. "Nothing recorded" is the right behaviour
for a mismatched declaration (a refusal is not a measurement), but it means the
negative control leaves NO queryable trace. The only place the exit-4 refusal
existed afterwards was free text in a `--override-attestation` reason. So:

> **The affirmative half of a falsifier campaign is attested and auditable; the
> negative half is neither. A reader six months later can verify that eight reds
> were machine-proven, and cannot verify that the mechanism was ever capable of
> saying no.**

Fix in flight: `scripts/falsifier-negative-control.ts`, a runnable oracle that
builds a throwaway corpus and asserts BOTH polarities — inert falsifier → exit
exactly 4 with nothing persisted, discriminating falsifier → exit exactly 0 with
an attested row persisted. Recording that script's own run is how the control
becomes evidence. ⛔ Generalizable: whenever a tool's correct response to a bad
input is to record nothing, proving the tool's discriminating power needs a
SEPARATE oracle that records the refusal itself.

## F8 — the plan's own test suite shipped a vacuous control, and only `assess` caught it

`assess` also raised a MINOR that machine-checked out as exactly right.
AC-SD-1's `RED (i)` permanently-pinned control — the one whose entire job is to
prove the rejected plain-symlink layout is detected — was **vacuous**. Its helper
`findEscapingScopeEntries` calls `isInside(realpathSync(entry), scratchDirAbs)`:
it resolves the ENTRY but not the BASE. On macOS `/var` is a symlink to
`/private/var`, so a base taken straight from `mkdtemp` never prefix-matches a
resolved entry, and EVERY scope entry is reported as escaping.

Measured against the real module with a CORRECT hybrid layout:

| base passed to the comparison | escaping entries reported |
|---|---|
| un-resolved (`/var/...`, what RED(i) passed) | `["core","dashboard","lore"]` |
| `realpathSync`'d (`/private/var/...`, what the HAPPY test passed) | `[]` |

So the control asserted a result it would have obtained from a correct layout.
Fixed by resolving the base; proved discriminating afterwards by pointing that
same test at a correct layout, which then failed with
`expected [] to deeply equal [ 'consumer', 'core', 'extra' ]`.

⛔ What makes this the sharpest finding of the session: this is the exact defect
class the whole spec exists to close — a control with no discriminating power —
occurring INSIDE that spec's own test suite, and it survived a red-first
implementer, two later agents extending the same file, an orchestrator-run
independent falsification, and an ATTESTED `--falsify` pass on AC-SD-1. It
survived attestation because the criterion's describe holds four tests and the
sound HAPPY one carried the red. ⇒ **A `-t <describe>` oracle attests the
describe, not each test in it; one vacuous test inside a passing describe is
invisible to `lore verify` by construction.** Neither the green control nor the
falsifier nor the attestation floor can see it. `lore assess` reading the test
source did.

## F9 — one stray directory under `packages/` aborts materialization

Also from `assess`, machine-checked: `materializeFalsifierDependencies` discovers
nested `packages/*/node_modules` by iterating the DERIVED workspace-member list,
while AC-SD-1(e)'s prose says it enumerates `packages/*/node_modules`.
`deriveWorkspaceMembers` returns `err` on any directory under a workspace base
dir with no readable `package.json` (`if (!memberJsonResult.ok) return
memberJsonResult;`). Therefore a single stray directory under `packages/` — a
scratch dir, an unpacked tarball — makes materialization fail for the entire
repo, and a nested `node_modules` under a non-member directory is invisible.
No current member is affected, so this is latent, not live. Prose-versus-code
divergence again: the AC says "enumerating", the code says "derived list".

## F10 — a latent hole the appended-note design leaves open

`_runFalsifier` treats a materialization failure as non-fatal: the reason is
appended to whichever annotation the run records, and execution falls through to
the green control. The argument for it is sound TODAY — every way materialization
can fail also leaves the scratch tree without usable `node_modules`, so the green
control fails and the row is `inconclusive`. ⛔ But the materializer ALSO refuses
loud when the scratch tree ALREADY has a `node_modules` entry, and that path is
unreachable only because the scratch worktree comes from `git stash create`
WITHOUT `--include-untracked`. Adding `--include-untracked` — explicitly named as
future scope in the ADR — could make the green control pass over a tree whose
workspace links were never redirected inward, i.e. re-open the F2 escape through
the error path. Recorded now because the guard that would catch it does not exist.
