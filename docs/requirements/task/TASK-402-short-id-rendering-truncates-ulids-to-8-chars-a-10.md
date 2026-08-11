---
id: TASK-402
type: task
role: plan
title: "Short-id rendering truncates ULIDs to 8 chars — a 1024ms window collapses to one printed id, across 9 sites with no shared formatter"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
---
Short-id rendering truncates a ULID to its first 8 characters, which discards the two
lowest base32 digits of the 48-bit millisecond timestamp. Every document created inside the
SAME 1024 ms window therefore prints an IDENTICAL id, and a correct output reads as a bug.

## Measured 2026-08-01 by the orchestrator

Two real corpus tasks created 214 ms apart:

    full  a: 01KYYDXH4SBSHGHAXNPKEY9SMB   (ts 1785580143769)
    full  b: 01KYYDXHBF3GXDSDJ22Q2ZYWKJ   (ts 1785580143983)
    trunc a: 01KYYDXH
    trunc b: 01KYYDXH        <- identical

`lore get adr-lore-done-requires-a-runner-attested-pass-the-sixth-false` prints BOTH of them
in its Navigation block as `01KYYDXH…`, under different titles. The reader cannot tell the
two apart, and the natural first reading is that the link table is corrupt.

## Root cause

A ULID's first 10 characters are the 48-bit millisecond timestamp in Crockford base32; the
remaining 16 are randomness. Truncating to 8 keeps only the high 40 bits of the timestamp, so
the printed prefix has a resolution of 32^2 = 1024 ms and carries ZERO entropy from the random
half. This is not a rare same-millisecond collision — it is a certainty for any batch corpus
write, which is the normal way documents are authored here.

## Where it lives — 9 sites, 3 files, no SSOT

    packages/lore/src/adapters/cli/utils.ts          6 sites (tree labels x2, Parent, Siblings, Children, Related)
    packages/lore/src/adapters/cli/commands/get.ts   1 site  (document header line)
    packages/lore/src/adapters/cli/commands/link.ts  2 sites (Linked <from> -> <to>, both operands)

Nine independent `.slice(0, 8)` literals for one display concept is itself the defect's
second half: there is no shared formatter to fix. `context-projection.ts:160` also slices to
8 but is a sha256 content hash, a DIFFERENT concept with different collision math — ⛔ do not
fold it into the same helper.

## Required

1. Introduce ONE shared short-id formatter and route all nine sites through it. ⛔ Do not fix a
   subset; a per-site patch reproduces the SSOT violation that made nine sites possible.
2. Choose the rendering and justify it in the module header — weigh at least these explicitly,
   ⛔ do not silently pick one:
   (a) lengthen the prefix — note that 10 chars is the full timestamp and still carries zero
       randomness, so same-millisecond writes still collide; any fix by lengthening must reach
       INTO the random half to work at all;
   (b) head+tail (`01KYYDXH…Y9SMB`), git-style;
   (c) print the slug instead of the id — slugs are unique and human-readable, and every one of
       these nine sites already has the title in hand;
   (d) shortest-unique-prefix computed against the corpus, git-style — costs a lookup.
   State the collision probability of the chosen form, do not assert it is "enough".
3. `--json` output is UNAFFECTED and must stay so — it carries full ids and machine consumers
   depend on them. This is a REGRESSION surface.

## Oracle

- NEGATIVE (the load-bearing case): create two docs inside the same second in a throwaway corpus,
  render both through each of the three surfaces (`lore tree`, `lore get` navigation, `lore link`),
  and assert the printed short ids DIFFER. This case fails today.
- HAPPY: a single doc renders a short id that still resolves via `lore get <short>` if that is
  claimed — if the chosen form is NOT resolvable, say so in the header rather than implying it.
- REGRESSION: `--json` payloads still carry untruncated ids on all three surfaces.
- REGRESSION: `context-projection.ts`'s sha256 slice is untouched.
- BOUNDARY: an id shorter than the render width (malformed/legacy) does not throw.
- ⛔ Never write to this repo's own `.lore/`: use `mkdtemp` + `lore init` per the canonical pattern
  in `packages/dashboard/tests/e2e/global-setup.ts`.

## Provenance

Filed from `knowledge-handoff-agent-main-orchestrator-63` NS5, which recorded it as an unfiled
minor ("two docs created in the same millisecond print an identical source id"). The measurement
above widens it: the window is 1024 ms, not one, and the blast radius is 9 sites across 3
commands, not `lore link` alone.
