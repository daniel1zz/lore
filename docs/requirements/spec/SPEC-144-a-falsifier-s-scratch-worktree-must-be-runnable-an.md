---
id: SPEC-144
type: spec
role: spec
title: "A falsifier's scratch worktree must be runnable AND observable: hybrid dependency materialization with the workspace scope redirected inward"
status: approved
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [falsifier, scratch-worktree, node-modules, isolation, mutation-observability]
parent: PRD-001
---
## Overview/Goal

Make a falsifier's scratch worktree **runnable** and **observable**, so that
`lore verify --falsify` over an `oracle: test` criterion can produce a genuine
runner-attested red instead of the `inconclusive` it universally records today.

Governing decision:
`adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid`.
Measurement this spec is built on:
`knowledge-a-symlinked-node-modules-makes-the-green-control-pass`.

The central claim this spec exists to enforce is that **runnability and mutation
observability are two independent properties**. AC-FR-11's green control
(`spec-falsifiability-reachability-a-feedable-checkpoint-an`) established the
first and is not changed by this spec. The plain-symlink layout satisfies the
first and silently destroys the second: `node_modules/@lore/core` is a relative
symlink, so resolution follows the outer `node_modules` symlink back to the
ORIGINAL checkout, and every bare-specifier import of a workspace package reads
unmutated source while the control reports a healthy environment. Measured
2026-08-23: a syntax error injected into a scratch tree's
`packages/core/src/index.ts` left the target test at exit 0, 77 passed.

## Scope

**In scope**
- Materializing dependencies into a scratch worktree created by
  `createFalsifierScratchWorktree`, using the hybrid layout the ADR fixes:
  a real `node_modules/` of symlinks to the main checkout's third-party entries,
  plus a real `node_modules/@lore/` whose entries point INSIDE the scratch tree.
- Deriving the workspace member set at runtime rather than enumerating it.
- Nested per-package `node_modules` (today `packages/dashboard/node_modules`).
- Proving mutation observability with its own oracle, paired with a green control.
- Proving the main checkout — working tree AND its own `node_modules` links — is
  untouched, and that cleanup cannot delete through a symlink into it.
- Driving the real `lore verify --falsify` CLI so the capability is proven
  REACHED, not merely present.

**Out of scope**
- `git stash create`'s missing untracked files (cause 2 of the original defect).
  A brand-new red-first test file stays absent and stays a legitimate
  `inconclusive`.
- Gitignored `dist/lore` (cause 3). A compiled-binary oracle stays
  `inconclusive`.
- Replacing worktree isolation with another primitive — pinned by AC-FR-3.
- Hardlinking or copying third-party packages. The ADR records the accepted,
  unmitigated residual risk: third-party packages are SHARED, so a test writing
  inside `node_modules` escapes isolation.
- Changing the green control itself. This spec changes what it runs against.

## Acceptance Criteria

Structured criteria are added via `lore ac add` and are the executable source of
truth; the prose below names only what each one is FOR.

- **AC-SD-1** — the layout is actually hybrid, nested trees included:
  `node_modules` and `node_modules/@lore` are real directories, every `@lore/*`
  entry realpaths INSIDE the scratch tree, a named third-party entry realpaths
  OUTSIDE it, and every nested `packages/*/node_modules` present in the main
  checkout — discovered by enumeration, not by name — resolves in the scratch
  tree. All five parts are required: the first three refuse the plain-symlink
  layout, the fourth refuses a full copy, and the fifth exists because a nested
  tree declared in scope with no assertion would let every other criterion pass
  over broken nested resolution.
- **AC-SD-2** — the workspace member set is DERIVED at runtime, so a package
  added later cannot silently revert to the rejected layout's blind spot.
- **AC-SD-3** — MUTATION OBSERVABILITY, the property no exit code from a passing
  control can establish: a mutation to a workspace package reached by BARE
  specifier makes the target command fail with output naming the mutated file's
  SCRATCH path, in the same worktree where the unmutated control exits 0.
- **AC-SD-4** — isolation non-regression: the main working tree stays
  byte-identical over a path set DERIVED from `git ls-files` at test time, never
  an implementer-chosen subset, with an empty `git status --porcelain`, AND the
  main checkout's own `node_modules/@lore/*` link targets are unchanged —
  materialization must not "fix" resolution by rewriting the original.
- **AC-SD-5** — both runners are served from one materialized worktree: a vitest
  file and a `.bun.test.ts` file each run green.
- **AC-SD-6** — PRODUCTION WIRING: a real `lore verify --falsify` invocation
  against a throwaway corpus persists an `expected-fail` row carrying an
  `attestation` block, read back out of the corpus.
- **AC-SD-7** — the green control is not disarmed: a command unrunnable for a
  reason materialization does not address still records `inconclusive` with no
  attestation.
- **AC-SD-8** — cleanup cannot delete through a symlink: after a run the scratch
  parent is gone and a sentinel inside the MAIN `node_modules` survives.


## Acceptance Criteria (structured)

- [✔] [script] AC-SD-1: LAYOUT IS ACTUALLY HYBRID, INCLUDING NESTED TREES: after materializing dependencies into a scratch worktree produced by createFalsifierScratchWorktree, (a) <scratch>/node_modules is a REAL directory and NOT a symlink (lstat), (b) <scratch>/node_modules/@lore is a REAL directory, (c) EVERY entry under it realpaths to a path INSIDE <scratch>, asserted by enumerating the directory at test time and never against a hand-listed set, (d) a named third-party entry (vitest) realpaths OUTSIDE <scratch>, into the main checkout node_modules, and (e) for EVERY nested per-package node_modules that exists in the main checkout — discovered by enumerating packages/*/node_modules at test time, not by naming packages/dashboard — the corresponding <scratch> path exists AND its directory listing is NON-EMPTY AND at least one entry name read from the MAIN nested tree realpaths, through the <scratch> path, to that same main-checkout entry. ⛔ "resolves to a readable directory" alone is NOT the check: an empty-but-readable directory satisfies those words while nested resolution stays broken, which is precisely the gap (e) exists to close. All five parts are required: (a)-(c) refuse the plain-symlink layout that the ADR rejects, (d) refuses a full copy, which would satisfy (a)-(c) while paying a 373MB walk per run, and (e) refuses both an absent nested tree and an empty placeholder. RED (four directions required): (i) replace materialization with a plain ln -s of the main node_modules and (c) must fail NAMING the escaping entry; (ii) copy the whole main node_modules in and (d) must fail naming vitest; (iii) skip nested trees entirely and (e) must fail naming the nested path that is absent; (iv) create each nested path as an EMPTY directory and (e) must still fail, on the non-empty and entry-realpath clauses. Covered by describe title "hybrid layout".
  script: test — bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts -t "hybrid layout" && echo 'AC-SD-1 PASS: real node_modules and @lore dirs, every @lore entry realpaths inside the scratch tree, vitest realpaths outside it, and every enumerated nested tree is non-empty with a verified entry realpath'
- [✔] [script] AC-SD-2: WORKSPACE SET IS DERIVED, NEVER ENUMERATED: the materializer computes its redirect set at runtime from the repository itself (the main node_modules/@lore directory listing, or the package.json workspace globs). Asserted by adding an ADDITIONAL workspace package to the fixture repo and running the materializer with NO code change: a redirect for that new package MUST appear, realpathing inside the scratch tree. RED: replace the derivation with a hand-listed array of the names that exist at implementation time and this test must fail NAMING the package that lost its redirect. ⛔ No literal package count appears in this criterion on purpose — a count is a claim with no oracle and rots as the workspace grows; the derivation requirement makes the number incidental. Rationale: a hand-listed set silently reverts a later-added package to the plain-symlink blind spot, which the green control cannot see. Covered by describe title "derived workspace set".
  script: test — bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts -t "derived workspace set" && echo 'AC-SD-2 PASS: a fourth workspace package added to the fixture gets a scratch-internal redirect with no code change'
- [✔] [script] AC-SD-3: MUTATION OBSERVABILITY, PAIRED WITH A GREEN CONTROL — the property no exit code from a passing control can establish: in ONE materialized scratch worktree, (a) the target test command UNMUTATED exits EXACTLY 0 (the green control; if this fails the whole test fails rather than crediting a red that came from a broken harness), and then (b) after mutating a file in a workspace package that the target reaches by BARE specifier (@lore/core), the same command exits EXACTLY 1 AND its combined output CONTAINS the mutated file absolute path under the SCRATCH directory. Asserting merely non-zero is unacceptable — a harness that never started also exits non-zero. RED (both required): (i) swap materialization for the plain-symlink layout and (b) must fail because the command goes green (measured 2026-08-23: exit 0, 77 passed, the exact defect this spec exists to prevent); (ii) break the scratch environment and (a) must fail rather than the test passing on a spurious red. Covered by describe title "mutation observability".
  script: test — bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts -t "mutation observability" && echo 'AC-SD-3 PASS: the unmutated control exits 0 and a bare-specifier workspace mutation exits 1 with the scratch path named in the output'
- [✔] [script] AC-SD-4: ISOLATION NON-REGRESSION, BOTH HALVES, OVER A DERIVED PATH SET: after a full materialize-mutate-run-cleanup cycle, (a) the MAIN checkout git status --porcelain is EMPTY and a digest over the sorted (path, content-hash) pairs of EVERY path returned by `git ls-files -z` in the main checkout is byte-identical before and after — the path set MUST be derived from git ls-files at test time, never an implementer-chosen subset, because an assertion whose coverage the implementer picks can shrink to one path and still report pass; and (b) the MAIN checkout own node_modules/@lore/* link TARGETS are unchanged, compared by readlink over an enumeration of that directory before and after. Half (b) is the non-obvious one: an implementation could make bare-specifier resolution work by rewriting the ORIGINAL checkout links instead of building scratch-internal ones, which would satisfy AC-SD-3 while corrupting the developer main tree. RED (three required): (i) apply the mutation in the working tree with a finally-block revert and kill the process mid-run, and (a) must fail; (ii) narrow (a) to a single hardcoded path and the derivation assertion must fail, proving the path set is enumerated rather than chosen; (iii) make the materializer repoint the main node_modules/@lore links at the scratch tree and (b) must fail naming the changed link. Extends AC-FR-3 of spec-falsifiability-reachability, which covers the working tree only and says nothing about node_modules. Covered by describe title "main checkout untouched".
  script: test — bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts -t "main checkout untouched" && echo 'AC-SD-4 PASS: main tree digest over git ls-files byte-identical, porcelain empty, and main node_modules/@lore link targets unchanged'
- [✔] [script] AC-SD-5: BOTH RUNNERS FROM ONE MATERIALIZED WORKTREE, EACH WITH ITS OWN FALSIFYING DIRECTION: in a single materialized scratch worktree, a vitest target file and a .bun.test.ts target file EACH exit EXACTLY 0, asserted by both exit codes plus each runner own summary line in the output (vitest "Test Files  1 passed", bun "0 fail"). This pins the .bun.test.ts population, which the repo two-runner split makes a separate reachability question and which vitest --changed is already structurally blind to. RED (both required, one per runner — neither half may be green-only): (i) omit the dotted entries (notably .bin) from the symlinked set and the VITEST invocation must fail, proving the .bin path is what that half depends on; (ii) run the SAME bun command in a scratch worktree with materialization SKIPPED and it must exit nonzero, proving materialization is what makes the bun half green rather than the bun runner resolving dependencies on its own. ⛔ Without (ii) the bun half would be a green-only assertion with no discriminating power, which is the exact defect class this spec was written to close. Covered by describe title "both runners".
  script: test — bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts -t "both runners" && echo 'AC-SD-5 PASS: vitest and bun test each exit 0 under materialization and each half fails under its own control'
- [✔] [script] AC-SD-6: PRODUCTION WIRING — the surface the service-level ACs do not reach: a REAL lore verify --falsify invocation, driven as the CLI against a THROWAWAY corpus (mkdtemp + lore init, never this repo .lore/), over a fixture AC whose oracle is a vitest command requiring node_modules and whose falsifier declares --falsifier-exit-code 1 (the value vitest returns for an assertion failure), PERSISTS an evidence row with result expected-fail carrying an attestation block whose exit_code EQUALS EXACTLY 1 — the declared value is named here on purpose so a reader can determine the expected number without external context — asserted by reading the row back OUT of the throwaway corpus, never from an injected recorder spy, and the CLI exits EXACTLY 0. RED (both required): (i) disable materialization and the persisted row must become result inconclusive with NO attestation, proving materialization is what changed the outcome AND that the green control still fires; (ii) make the runner skip persistence and the read-back must fail to find the row. Rationale: an attested pass at the service layer is not evidence of production wiring — this repo has measured that shape three times.
  script: test — bunx vitest run packages/lore/tests/integration/cli/verify-falsify-dep-materialization.test.ts && echo 'AC-SD-6 PASS: a real lore verify --falsify run persists an expected-fail row whose attestation exit_code is exactly 1, read back from a throwaway corpus'
- [✔] [script] AC-SD-7: THE GREEN CONTROL IS NOT DISARMED: with materialization ENABLED, a falsifier whose AC command is unrunnable for a reason materialization does not address — specifically a command naming a test file that exists in the working tree but is UNTRACKED, so git stash create omits it — still records result inconclusive with NO attestation block, and never records expected-fail. This is the regression guard on AC-FR-11: making the environment usable for the dependency cause must not make the control unable to fire for the other two causes (untracked files, gitignored dist/lore), both of which remain explicitly out of scope. RED (both required): (i) hardcode the green control to always pass and this must fail because the row becomes expected-fail; (ii) make materialization also stage untracked files and this must fail — that would be a scope change requiring its own spec, not a silent widening. Covered by describe title "green control still fires".
  script: test — bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts -t "green control still fires" && echo 'AC-SD-7 PASS: an untracked-test-file oracle still records inconclusive with no attestation under materialization'
- [✔] [script] AC-SD-8: CLEANUP CANNOT DELETE THROUGH A SYMLINK: a sentinel file written inside the MAIN checkout node_modules before the cycle still EXISTS with identical content after removeFalsifierScratchWorktree runs, and the scratch parent directory no longer exists. Both halves required. This guards the single most destructive failure mode the hybrid layout introduces: cleanup is a recursive delete over a tree that now contains 400+ symlinks pointing INTO the developer main node_modules, so a follow-symlinks delete would destroy the real dependency tree. RED (both required): (i) implement cleanup with a symlink-FOLLOWING recursive delete and the sentinel must vanish, failing this test; (ii) make cleanup a no-op and the scratch-parent-absent half must fail, so the test cannot be satisfied by simply not deleting anything. Covered by describe title "cleanup cannot escape".
  script: test — bunx vitest run packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts -t "cleanup cannot escape" && echo 'AC-SD-8 PASS: the main node_modules sentinel survives cleanup and the scratch parent is gone'

## Code anchors

- packages/lore/src/service/falsifier-dep-materialization.ts#materializeFalsifierDependencies
- packages/lore/src/service/falsifier-dep-materialization.ts#deriveWorkspaceMembers
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts
- packages/lore/tests/integration/cli/verify-falsify-dep-materialization.test.ts
