---
id: PLAN-124
type: plan
role: plan
title: "Land oracle exclusivity: a mirror check that can fail, a guard that sees mirror content, a gitignored probe namespace, and a serialized suite"
status: approved
priority: high
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: SPEC-136
phases:
  - {name: "guard-widen", description: "AC-OX-2: pure pollution-guard predicate returning offending paths, widened to docs/requirements, wired before AND after the suite"}
  - {name: "isolation", description: "AC-OX-3, AC-OX-4: gitignored .scratch probe namespace asserted both sides, plus the checkout-level oracle mutex"}
  - {name: "readonly-oracle", description: "AC-OX-1: the AC-FR-10 mirror oracle drives --check instead of the write-mode exporter. DISPATCH LAST, after the mirror is re-exported on main"}
---
# Goal

Land the four ACs of `spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`. Each exists
because an oracle in this repo could not distinguish its own success from its own side effects.

## Phases

Phase NAMES are fixed by the tasks already attached; the DISPATCH ORDER below is what governs, and it
is deliberately the reverse of the order the phases were created in.

**Dispatch 1 — `readonly-oracle` (AC-OX-1).** Make the AC-FR-10 mirror oracle drive `--check` instead
of the write-mode exporter, so it can actually fail and stops dirtying the live corpus. **This goes
FIRST, not last.** While `const baseline = runMirrorScript([])` is still live, every full-suite run
writes `.lore/export-index.json` and `docs/requirements/**` mid-run — so any before/after cleanliness
assertion built before this lands reds for a reason unrelated to the change under test. Landing D1
first is what makes the rest of the plan verifiable.
⛔ Gated on one orchestrator action: the mirror must be re-exported and committed on `main` first,
because AC-OX-1 asserts `git status --short .lore docs/requirements` is empty against the LIVE tree
and this session's corpus writes leave it stale.

**Dispatch 2 — `guard-widen` (AC-OX-2).** Extract the pollution guard's decision into a pure predicate
and widen its scope to `docs/requirements/**`. The predicate RETURNS the offending paths **and the
guard PRINTS them** — both halves are required; a guard that knows which paths are dirty and stays
silent reproduces the exact attribution cost this plan exists to remove. ⛔ Only the pure predicate
and its unit test are tree-independent; the e2e wiring is BY DEFINITION a live-tree assertion (it
feeds real `git status --short` output for `.lore` and `docs/requirements/**`, before AND after the
suite). That is precisely why it is sequenced after Dispatch 1 rather than concurrent with it.

**Dispatch 3 — `isolation` (AC-OX-3, AC-OX-4).** The `.scratch/` probe namespace asserted statically
(gitignored, and matching no tsconfig `include` across all seven projects) plus the compile-error
discrimination proven in an ISOLATED temp project, and the checkout-level oracle mutex. Genuinely
independent of tree freshness and of the other two dispatches — no anchor intersects and no oracle
here reads live tree state — so it may run CONCURRENTLY with either, in its own linked worktree.
⛔ Nothing in this phase writes a broken file into a real typechecked glob.

## Sequencing Risks

- **⛔ No task in this plan may run the FULL suite (`bun run test`), and that ban is about the code
  path, not just the command.** Until Dispatch 1 lands, the suite ITSELF invokes the exporter in write
  mode; and in a linked worktree `.lore/lore.db` resolves UP to the main checkout, so that write
  produces shared-DB-derived mirror files inside the worktree and carries them into a merge. Banning
  only `bun run mirror:export` would leave the same effect reachable through `bun run test`. Scoped
  oracles only (`bun run test:changed`, the specific test file, `bun run typecheck`); the full suite is
  the orchestrator's, on `main`, after Dispatch 1 is merged.
- **The mutex's lock path is load-bearing and is pinned by D5**: `git rev-parse --git-common-dir`,
  shared by the main checkout and every linked worktree. ⛔ A per-worktree lock would compile, pass a
  naive test, and protect nothing. Symmetrically, AC-OX-4's tests must drive `main(lockDir)` with an
  injected `mkdtemp` directory and never the real path, or a concurrent suite run elsewhere in the
  checkout perturbs the contention assertions.
- **⛔ Dispatch 3's reverse control must NEVER write a broken file into a real typechecked glob**, and
  filename uniqueness plus `finally` cleanup does not license it. Per parent D4 the collision vector is
  *presence in a typechecked glob at all* — the window is the duration of the run, not the persistence
  of the file — so a transient unique-named probe reds every concurrent `typecheck` in the checkout just
  the same. An oracle that reproduces the defect in order to prove the defect is not acceptable. The
  sanctioned form is the ISOLATED temp project (own tsconfig, own `src`, `mkdtemp`), with `.scratch/` as
  the standing home for any probe that must live in the checkout.
- **Dispatch 1's oracle reds on stale mirror state, which is the intended behaviour** (D2). Do not
  soften AC-OX-1 to make a stale tree pass; fix the staleness instead.
- **`tsc` exit 1 vs 2 is load-bearing** (D6): 1 means it checked and found errors, 2 means it never
  checked (`TS18003`). Assert the exact code AND the expected filename in the output; never "nonzero".

**Orchestrator-owned, not assigned to any phase:** (a) the pre-Dispatch-1 mirror re-export and commit
on `main`; (b) correcting the gap-ledger entry for G19 in
`knowledge-attestation-is-structurally-one-sided-lore-verify-can`, whose recorded scope points at a
branch that no longer exists (`git branch -a` lists only `main`; `git log --all --grep=a9f801dd` is
empty) while the defect is on `main`. (b) is a corpus edit on a shared knowledge doc, so an implementer
must not make it from a worktree. ⛔ All four ACs could land green with the mis-scoped entry surviving,
which is why it is tracked here rather than left implicit.

## Out of Scope

The mirror's `human_id` two-writer disagreement and the `migrate ordinals` reversion loop — a separate
approved spec owns those. ⛔ No task here may touch
`packages/lore/src/service/ordinal-migration-service.ts`, `packages/core/src/ordinal.ts` or
`packages/core/src/schemas.ts`.
