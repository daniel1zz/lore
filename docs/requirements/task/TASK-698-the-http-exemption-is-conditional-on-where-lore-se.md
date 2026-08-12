---
id: TASK-698
type: task
role: plan
title: "The HTTP exemption is conditional on where lore serve was launched, not on the adapter"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Measured 2026-08-12 on merged main, after all five tasks of plan-land-corpus-resolution-provenance-one-pure-resolver-one were archived. Disclosed unprompted by the AC-CP-5 implementer, confirmed by direct inspection, and independently re-derived by `lore review` on v25 of the governing spec, which escalated on the contradiction before it was written down.

## The defect

spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5 names HTTP as an exemption: it has no per-call caller directory, so it supplies `provenance: null` and the foreign-corpus-write predicate is inert. That is the INTENDED contract and it is what AC-CP-5(c) pins.

The landed implementation does not deliver it. `packages/lore/src/adapters/cli/commands/serve.ts:26` calls `loadLoreApp()`, and `packages/lore/src/adapters/cli/loader.ts:355` sets `provenance: resolveCorpus(process.cwd())?.provenance ?? null` from the SERVER's own startup directory, for every surface that boots through it. So HTTP sees `null` only when `lore serve` happened to be launched from a non-nested location.

Launched from inside a nested worktree, the server's corpus service carries `git_common_dir` and EVERY HTTP write is refused with exit 4 / `gate:corpus-write:foreign-provenance`. An HTTP caller has neither a per-call directory nor a claim lease, so it cannot declare intent and cannot recover. That is a lockout, and it is the exact outcome the named exemption exists to prevent.

## Why the existing oracle did not catch it

AC-CP-5(c)'s typed spy drives a bare `CorpusService` carrying the constructor default `{provenance: null, enabled: true}`, which faithfully represents the intended shape but is not the object `loadLoreApp` wires. The gap is in the AC's REACH, not in its claim — the same distinction this repo already records as "an attested pass is not evidence of production wiring".

## What must land

1. `loadLoreApp` must supply `null` provenance on the HTTP surface, keyed on the caller surface it already computes (`app.callerSurface` is set immediately before line 355), never on the server's startup directory.
2. The oracle must drive the `loadLoreApp`-wired path, not a bare service. An assertion that only exercises the constructor default cannot fail when the wiring is wrong — that is why this defect survived an attested pass.
3. The reverse control must exist too: booting `loadLoreApp` on the CLI surface from a nested worktree must still yield `git_common_dir`, so the fix cannot be "pass null everywhere".
