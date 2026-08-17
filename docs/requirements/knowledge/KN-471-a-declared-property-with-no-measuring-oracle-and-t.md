---
id: KN-471
type: knowledge
role: knowledge
title: "A declared property with no measuring oracle, and the red-first vs falsifier deadlock that leaves every early AC's discriminating power asserted rather than demonstrated"
status: draft
priority: high
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
Three non-blocking advisories on `spec-corpus-truthfulness-a-verdict-must-carry-the-state-it`
(review judge, approve @ 0.74, 2026-08-17) all name the same defect class, and it is one this
corpus has no vocabulary for yet: **an AC clause that states a property without naming the oracle
that measures it.** Such a clause reads as an assertion, survives review, and then silently becomes
implementer discretion — the gap between "the AC says X" and "something checks X".

Recorded separately rather than folded into the spec because editing an approved doc resets it to
`draft` and would discard a fresh review judgment; these are refinements to redeem when the
implementing tasks are cut, not corrections to the design.

## The three measured instances

### 1. AC-CT-6 — a size-independence claim with no measuring oracle
The criterion asserts the convergence step's work is "CONSTANT with respect to corpus size — one
indexed read plus one index-field read; it never enumerates docs". Byte-equality before/after
covers **side-effect freedom**, not **work performed**. Nothing in the AC says how constancy is
measured, so an implementer must invent the mechanism: counted store calls, a query-log assertion,
or a two-fixture corpus of differing size showing flat cost. Also: the `p95 < 200ms` fixture pins
the *corpus* ("this repository's live corpus") but not the machine or its load, so the number is
still environment-dependent — the very class of defect this criterion's own correction record
objects to, now one level shallower.

### 2. AC-CT-1 — a global-uniqueness claim asserted by nothing
"The projection is the ONLY one in the codebase" is a claim about the whole repo. It appears to
lean on AC-CT-7's site scan, but **that scan is scoped to `.fail` / `.pass` reads off an
`AcCoverageFact`, not to duplicate glyph projections** — a second `switch` mapping seven states to
glyphs, written without touching those fields, would pass both criteria while re-introducing the
divergence the whole slice exists to remove.

### 3. AC-CT-4 — an unresolvable radius has no declared classification
The radius resolution rule is pinned ("the AC's script-mode command target plus the governing
task's `file_anchors`"), and "declares NO radius → `unmeasured`" is measurable. But the *failure*
modes are unclassified: a command target that resolves to a package script name, a glob, or a
directory; `file_anchors` naming a deleted path. An implementer could map those to `bound` or to
`unmeasured` — **opposite safety consequences**, since `bound` silently certifies a verdict whose
radius was never actually compared.

## The tooling gap underneath, which is the more important half

`lore ac add --falsifier-path/--find/--replace/--exit-code` **cannot be declared for a capability
that does not exist yet**: `--falsifier-find` requires the literal string to be present on disk at
attested-red time, and a stale falsifier is refused loud. So for a red-first AC — one authored
*before* its implementation, which is the discipline this project mandates — the falsifier can only
be declared *after* the code lands.

⛔ **There is a structural tension here, not merely an inconvenience**: red-first requires the AC to
precede the implementation; the falsifier facility requires the implementation to precede the
declaration. Every one of the 7 ACs on the corpus-truthfulness spec therefore carries its falsifier
as PROSE ("MANDATORY FALSIFIER once implemented: …") rather than as structured fields.

And as the judge put it precisely: **nothing named there forces that deferral to be redeemed.** A
prose "MANDATORY … once implemented" is exactly the TODO shape this project's own discipline
forbids. Two mechanisms would close it, and neither exists today:

1. **A redemption check.** `lore status --check-falsifier-debt`: any script-mode AC on an
   `approved` spec whose `verify.command` path now EXISTS on disk but which carries no structured
   falsifier is reported. That inverts the tension — the debt becomes visible exactly when it
   becomes payable, and it is a corpus-wide integer, so it doubles as a progress metric.
2. **A `--falsifier-deferred <reason>` flag** that stores the intended mutation as structured data
   (path, find, replace, exit code) WITHOUT validating that `find` is on disk yet, marking the AC's
   falsifier as declared-but-unvalidated. `lore verify` refuses to count such an AC as
   falsifier-covered, and the redemption check from (1) reads that flag rather than inferring.

Option 2 is strictly better: it captures the author's intent at the moment it is clearest (while
designing the AC), rather than asking a future session to reconstruct it. Option 1 alone would
still be an improvement over today, where the deferral is invisible.

## Why this matters beyond one spec

The project's standing position is that an oracle never observed red has no demonstrated
discriminating power. A prose falsifier is not an observation. So today, **every red-first AC in
this corpus is in a state where its discriminating power is asserted rather than demonstrated**,
and there is no query that tells you how many. That number is currently unknown, which is itself
the finding.
