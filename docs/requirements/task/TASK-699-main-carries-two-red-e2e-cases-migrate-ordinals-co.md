---
id: TASK-699
type: task
role: plan
title: "main carries two RED e2e cases: migrate-ordinals-compiled expects SPEC-1 while the compiled binary emits the zero-padded SPEC-001 — a deterministic format divergence sitting red on a clean tree, unmentioned by any handoff"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
links:
  - {id: TASK-700, type: relates-to}
---
## Measured 2026-08-12 by the orchestrator — on a CLEAN tree at main `18c52cf8`

    bun run build                       -> exit 0
    cd packages/lore && bun test tests/e2e/migrate-ordinals-compiled.bun.test.ts
      -> exit 1 | 3 pass, 2 fail, 52 expect() calls

Both failures are the SAME assertion shape, at `migrate-ordinals-compiled.bun.test.ts:451`:

    expect(reconcile.new_human_id).toBe("SPEC-1")
      Expected: "SPEC-1"
      Received: "SPEC-001"

Failing cases (both under `AC-084-5: compiled dist/lore migrate ordinals`):

- `HAPPY+BOUNDARY: dry-run computes the full converging report … with ZERO writes`
- `STATE: --apply converges the corpus (bijective ordinals, prose-pure titles, export-index reconciled, SPEC-<n>/ADR-<n> resolve)`

## Why this is filed rather than fixed inline

It surfaced as collateral in `bun run test:changed` during an unrelated hook change, and the
implementer correctly flagged it as unattributable rather than absorbing it. The BASELINE was then
established independently: the same two cases fail identically on a clean tree at `18c52cf8` with the
hook diff nowhere present. ⛔ It is therefore NOT caused by that change, and equally NOT a flake —
the received value is deterministic across runs.

## What must be decided before it is "fixed"

⛔ Do not simply relax the assertion to `SPEC-001`. The question is which side is wrong, and that is
a CONTRACT question:

1. If zero-padded `SPEC-001` is the intended human-id rendering, the test is stale and the fix is the
   test — but then every other surface that renders or PARSES a human id must be checked for the same
   assumption, and the failing case's own title (`SPEC-<n>/ADR-<n> resolve`) is stale too.
2. If `SPEC-1` is intended, the binary regressed and the fix belongs in the migrate/reconcile path.
3. Either way `SPEC-<n>` vs `SPEC-00n` is a RESOLUTION surface: `lore get SPEC-1` and
   `lore get SPEC-001` must not disagree about which document they name. Assert that explicitly —
   a silent resolution to a DIFFERENT document is the dangerous outcome here, not the failing string.

Search first: `knowledge-assessment-implementation-spec-084-corpus-allocated` covers the SPEC-084
ordinal work and is the likeliest source of the intended contract.

## Why the redness survived unnoticed

The pre-push gate runs FOUR corpus checks and NO tests, so a red e2e case is push-invisible. Same
shape as the stale-manifest incident (`c3803eb2`): a sound oracle that nothing invokes is not a gate.
The two RED cases have been sitting on main long enough that the most recent handoff
(`knowledge-handoff-agent-main-orchestrator-91`) does not mention them.

## Oracle

- The two named cases pass on a clean tree at a named commit, exit code measured as TWO SEPARATE
  statements (`cmd > out 2>&1` then `echo $?`) — chained on one line you measure `echo`'s own 0.
- REGRESSION: the other 3 cases in the file stay green and their assertions are unchanged.
- CONTRACT: whichever rendering wins, `lore get` resolves BOTH `SPEC-1` and `SPEC-001` to the same
  doc, or fails loudly on the one it rejects — never silently returns a different document.
- ⛔ Never write to this repo's own `.lore/`: use `mkdtemp` + `lore init` per the canonical pattern in
  `packages/dashboard/tests/e2e/global-setup.ts`.

## Provenance

Baseline established 2026-08-12 while merge-verifying
`task-the-git-safety-gate-s-worktree-rule-matches-only-force-and`.
