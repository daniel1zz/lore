---
id: KN-255
type: knowledge
role: knowledge
title: "An SSOT-to-installed parity check is unfalsifiable when the installed path is a symlink into the SSOT — the prescribed distribution oracle is inert on this machine"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: KN-325, type: relates-to}
---
## The claim being qualified

CLAUDE.md carries a standing lesson:

> **SSOT↔installed asset pairs** need content-parity or content-invariant assertions —
> manifest presence alone makes "fixed in both copies" unverifiable (bidirectional
> divergence observed).

Correct in general. **On this machine it is inert**, and the inertness is invisible at
the call site.

## Measured 2026-08-01

After editing `assets/skills/lore-session-review/{SKILL.md,references/invariants.md}`
(adding invariants I7b / I12 / I13), the orchestrator ran the parity check the lesson
prescribes:

```
shasum -a 256 assets/skills/lore-session-review/references/invariants.md
shasum -a 256 ~/.claude/skills/lore-session-review/references/invariants.md
→ SAME
```

`SAME` here proves nothing. `~/.claude/skills/lore-session-review` is a **symlink into
the repo**:

```
~/.claude/skills/lore-session-review -> /Users/apple/Projects/zz/lore/assets/skills/lore-session-review
stat -f %i  both paths → 152022075   # one inode, one file
```

The two operands of the comparison are the same file. The assertion is not weak — it is
**unfalsifiable**: no edit, no omission, no half-applied fix could ever make it print
`DIFF`. It is a green light wired to nothing.

## Why this is not a duplicate of the existing symlink finding

`knowledge-lore-setup-follows-a-dev-symlink-into-assets-and` (2026-07-30) records the
symlinks and their destructive interaction with `lore setup`, and the owner decided to
KEEP them as deliberate dev convenience. That decision stands and is not questioned here.

What is new is the **verification** consequence: with the symlinks in place, the specific
oracle CLAUDE.md recommends for distribution work degrades to a tautology on the
developer's own machine — the exact machine where the fix is being verified. The
2026-07-30 doc is about what setup DOES to the SSOT; this is about what the developer
CANNOT LEARN while it is there.

## The general shape

This is the sixth member of the false-oracle family already catalogued in CLAUDE.md
(mistyped AC paths · under-match · wrong execution root · stale compiled binary ·
silently-inert CLI flag). The unifying property: **a check whose two sides are not
independent cannot fail**, and "cannot fail" is indistinguishable from "passed" in
every log, every transcript, and every completion report.

Ask of any parity/consistency assertion, before trusting it:

> Is there a physically reachable state of the world in which these two operands differ?

If the answer needs a symlink check, a filesystem-identity check, or a build step to
answer, the assertion is not yet an oracle.

## What to do instead, for distribution work on this machine

Parity between `assets/` and `~/.claude/` is not measurable here. The reachable
substitutes, in order of strength:

1. **Manifest digest** — `node scripts/embed-assets-manifest.mjs --check` (exit 3 stale /
   0 fresh). Independent of the symlink: it recomputes over the `assets/` tree and
   compares against the digest embedded in the binary's generated file. Used in this
   session: red before regeneration, green after — a real transition, not a tautology.
2. **The distribution suite** — `setup-manifest-fields.bun.test.ts`,
   `assets-ssot.test.ts`, `setup-governance-retirement.test.ts`, which exercise the
   install path against throwaway targets rather than `~/.claude`.
3. **A genuinely fresh consumer install** into a temp HOME — the only thing that measures
   the pipe end to end, and the only one that would have caught a manifest-registered
   file that setup never actually writes.

None of these is the parity check. That is the point: on this machine, the prescribed
check must be REPLACED, not merely supplemented.
