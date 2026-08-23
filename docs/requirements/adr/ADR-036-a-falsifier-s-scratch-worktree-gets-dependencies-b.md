---
id: ADR-036
type: adr
role: decision
title: "A falsifier's scratch worktree gets dependencies by hybrid symlink, with the workspace scope redirected inward — runnability and mutation observability are separate assertions"
status: draft
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [falsifier, scratch-worktree, node-modules, isolation]
parent: PRD-001
---
## Context

`lore verify --falsify` is the corpus's only mechanism for machine-proving that an
AC's oracle can go red. It applies the declared mutation in a scratch git worktree
(`git stash create` → `git worktree add`), which AC-FR-3 of
`spec-falsifiability-reachability-a-feedable-checkpoint-an` pins: the mutation MUST
NOT touch the working tree, proven by byte-identity plus an empty
`git status --porcelain`, including when the run crashes mid-way.

`node_modules` is gitignored, so it is never in a `git stash create` tree. Before
AC-FR-11, that produced a 100% false-match rate: 11 of 11 invocations recorded a
runner-attested `expected-fail` from a module-not-found error, because both vitest
and bun test exit 1 for a startup failure and for an assertion failure alike.
AC-FR-11 added a green control — run the UNMUTATED command first, record
`inconclusive` with no attestation when it fails. That is strictly correct, and it
moved the mechanism from FALSE reds to NO reds: every `oracle: test` criterion in
this repo now resolves to `inconclusive`. Both states leave discriminating power
unproven, so the falsifier is still effectively inert.

The decision this ADR settles: **how a scratch worktree gets usable dependencies
without giving up the isolation AC-FR-3 pins.**

## Decision

Materialize dependencies into the scratch tree as a **hybrid symlink layout**:

- `<scratch>/node_modules/` is a REAL directory.
- Every top-level entry of the main checkout's `node_modules` — including dotted
  entries such as `.bin` — is symlinked into it, EXCEPT the workspace scope
  (`@lore`).
- `<scratch>/node_modules/@lore/` is a REAL directory whose entries point at
  `<scratch>/packages/<name>`, i.e. INSIDE the scratch tree.
- The workspace member set is DERIVED at runtime (read the main
  `node_modules/@lore/`, or the workspace globs), never hand-listed.
- Nested per-package `node_modules` (today only `packages/dashboard/node_modules`)
  are symlinked to their main-checkout counterparts.
- The green control from AC-FR-11 stays exactly where it is. This decision changes
  what the control is run against, never the control itself.

## Rationale, and why the obvious option is rejected

Measured 2026-08-23, `knowledge-a-symlinked-node-modules-makes-the-green-control-pass`:

| layout | green control | cross-package mutation visible | same-package mutation visible |
|---|---|---|---|
| no `node_modules` (status quo) | exit 1 | n/a — never runs | n/a — never runs |
| plain `ln -s <main>/node_modules` | exit 0 | **NO** (exit 0, 77 passed) | yes |
| hybrid (this decision) | exit 0 | yes (error names the scratch path) | yes |

⛔ The plain symlink — the first option anyone reaches for, and one of the four
listed as open in the predecessor doc — is REJECTED because it is a new false
oracle, not a fix. `node_modules/@lore/core` is a relative symlink
(`../../packages/core`); resolution follows the outer symlink first, so it lands
back in the ORIGINAL checkout. Every bare-specifier import of a workspace package
therefore reads unmutated source while the green control reports a healthy
environment. That is the harder failure to catch, because the control — a sound
oracle for runnability — stays green through it.

The generalization this rests on: **for any harness running against a COPY of a
tree, "the harness starts" and "the harness observes the copy" are independent
properties, and no exit code from the first can establish the second.**

The other options measured and rejected:

- **`--include-untracked` on the stash.** Necessary for a red-first AC's brand-new
  test file (cause 2 of the original defect) but does nothing for `node_modules`,
  which is GITIGNORED rather than merely untracked. Complementary, not a
  substitute; out of scope here.
- **Install inside the scratch tree.** ⛔ Already observed to fail: a pre-fix
  evidence tail shows `bun install` having run and the command still failing. Also
  pays a full install per falsifier run.
- **Abandon worktree isolation.** Conflicts with D3 and is pinned by AC-FR-3's
  crash-isolation assertion. Not available.

Hardlinking instead of symlinking the third-party entries was considered and not
chosen: it costs a 373 MB tree walk per run and buys only protection against a
test that WRITES into `node_modules`, of which none is known here. The residual
risk is recorded below rather than paid for up front.

## Consequences

- A falsifier over an `oracle: test` AC can produce a genuine attested red again,
  which is the whole point of the mechanism.
- ⛔ Two properties, not one, must be asserted from here on: **runnability** (the
  green control, AC-FR-11) and **mutation observability** (nothing the command
  imports resolves outside the scratch tree). The second needs its own oracle,
  because the layout that breaks it leaves the first green. Its falsifier is
  exactly the plain-symlink layout, which makes it cheaply testable.
- The workspace member set becomes load-bearing: a fourth package added without
  the derivation seeing it silently reverts to the rejected layout's blind spot.
  Derivation-not-enumeration is therefore part of the decision, not an
  implementation detail.
- Third-party packages are SHARED with the main checkout. A test that writes
  inside `node_modules` would escape isolation, and AC-FR-3's byte-identity
  assertion covers the working tree only. Accepted, recorded, unmitigated.
- `git stash create`'s missing untracked files and gitignored `dist/lore` remain
  causes of a legitimate `inconclusive`. This decision addresses ONLY the
  dependency cause.
