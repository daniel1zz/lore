---
id: KN-463
type: knowledge
role: knowledge
title: "Retired from root CLAUDE.md: eight pointer-less standing lessons"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
# Retired from root CLAUDE.md: eight pointer-less standing lessons

Evicted 2026-08-17 when an edit tripped the root CLAUDE.md eviction floor (24209/24576 bytes, floor
0.97). These eight standing lessons carried no corpus pointer of their own, so they were the block
whose removal costs the least retrievability. Verbatim text below; the root file now carries a single
pointer at this doc.

Each remains normative. Nothing here was superseded — this is a storage move, not a retraction.

---

- Contiguous-substring matchers degrade silently to no-match — key on lone tokens + independent
  negative conditions.

- SSOT↔installed asset pairs need content-parity assertions; manifest presence proves nothing.

- Every distribution pipe and gate-read field needs an install→visible / author→trip end-to-end
  oracle.

- Worktree dispatch: `bun install` FIRST; verify `git log` on the branch BEFORE merge+cleanup.

- `spawnSync` on a growing `--json` payload needs explicit `maxBuffer`; ⛔ `set -e` is INERT in the
  agent shell — chain with `&&` and assert resulting state after every batch.

- Main-checkout oracle runs need `LORE_ACTOR=agent:main-orchestrator` — nothing enforces it.

- In a shared checkout, commit PATH-SCOPED (`git commit -m "<msg>" -- <paths>`).

- A full-suite verdict requires a CLEAN tree at a named commit.

---

## Why these eight and not others

The root file's standing-lesson list mixes two kinds of entry: lines that end in a corpus slug (a
pointer into the full measured account) and lines that stand alone. Evicting a pointered line saves
almost nothing — its long form already lives in the corpus and the line is mostly the pointer. The
eight above were the pointer-less ones, so moving them is the only eviction that actually reclaims
bytes while leaving every fact addressable.

Two lessons deliberately stayed in the root file despite being pointer-less in spirit:
`Spec close-outs write NOTHING to this file` (it governs edits to that very file, so a reader who
never opens the corpus still needs it) and the `--check-*` exit-code family conventions embedded in
other sections.
