---
id: KN-197
type: knowledge
role: knowledge
title: "The substring-matcher lesson has a mirror face: over-matching, and a corpus that documents its own markers is where it fires"
status: approved
priority: medium
created: 2026-08-06
updated: 2026-08-06
tags: [retro, false-oracle, matcher, validity, census]
parent: PRD-001
links:
  - {id: TASK-364, type: relates-to}
---
# Retro — the substring-matcher lesson has a MIRROR face: over-matching, and a corpus that documents its own markers is where it fires

The repo already carries a standing lesson: *contiguous-substring matchers degrade silently to
no-match — key on lone tokens + independent negative conditions*. Measured 2026-08-06: the same
matcher class degrades in the OPPOSITE direction just as silently, and the lore corpus is
structurally the worst place for it, because the corpus **documents its own markers**.

## What happened

Running the direct-address validity census that `task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in`
makes necessary (there is no validity field to filter on, so each doc must be addressed
individually), a first-pass classifier over `lore get <slug>` output used:

```
grep -q  'INVALIDATED'   -> INVALIDATED
grep -qi 'RETRACTED'     -> RETRACTED-BODY
```

over `head -12` of each of the 28 open task drafts. It returned **3 positives**. Precise
re-classification returned **1**. Both extra positives were false, by two DIFFERENT mechanisms:

| slug | why it falsely matched |
|---|---|
| `task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in` | its own defect heading is `# Defect — a RETRACTED doc is indistinguishable…` — the marker appears as SUBJECT MATTER |
| `task-mcp-lore-create-supersedes-still-creates-then-fails-the` | prose quotes another doc's slug, `task-a-task-cannot-be-retracted-supersedes-emits-a-repair` — the marker appears INSIDE A QUOTED SLUG, and only the case-INSENSITIVE variant saw it |

The second one is the sharper finding: a case-sensitive grep over the FULL output found nothing,
while the case-insensitive grep over the first 12 lines found a hit. Two spellings of "the same"
check disagreed, and neither disagreement was announced.

## Mechanism root

A marker census over a corpus is a search for the marker's USE, but a grep finds every
MENTION. In a self-documenting corpus these two sets diverge by construction: defect docs are
*named after* the markers they investigate, and slugs quoting a marker circulate as prose. The
denominator grows every time the team files a defect about a marker — so this class of matcher
gets monotonically WORSE as the corpus matures, silently.

This also inverts the received framing. The existing lesson treats over-narrow matching as the
risk (silent no-match). Here over-BROAD matching produced a positive that a careless reader would
have acted on — and acting on it would have meant cancelling a correctly-dispatched task as
"retracted".

## The correct shape

1. **Anchor to the marker's STRUCTURAL position, not its text.** The authoritative signal for
   invalidation is lore's own emitted banner line (`> ⚠ INVALIDATED <ts> — superseded by …`), and
   for a body-level retraction it is a HEADING (`^#+ *⛔? *RETRACTED`), never a bare word.
2. **Require two INDEPENDENT conditions to agree.** The one true positive
   (`task-lore-evidence-ac-accepts-an-ac-ref-on-an-ad-hoc-task-that`) satisfied banner=YES AND
   heading=YES. Both false positives satisfied exactly one, and the weaker one.
3. **Never let case-sensitivity and scope vary together between passes.** `head -12 | grep -i`
   vs. full-output `grep` are two different oracles; disagreement between them must be treated as
   a finding, not silently resolved in favour of whichever ran last.

## Addendum, measured later the same session — an ID PREFIX is also a colliding lone token, and ULIDs make it collide BY CONSTRUCTION

`task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in`'s AC-2 prescribes the remedy
"assert by ID, never by title — the title column truncates". That prescription shipped, and it is
**under-specified**: it does not say how much of the ID.

Verifying the merged fix from the main checkout, an 8-character ID-prefix probe
(`grep -c '^01KYYB5H'` against the default human listing) returned **1** where the correct answer
was **0**. Cause: `lore list`'s human column shows a truncated ULID, and ULIDs are
**time-ordered** — their leading characters encode the creation timestamp. Two task docs created
in the same window share a long prefix:

```
01KYYB5HZS…  ← the retracted doc
01KYYB5HT1…  ← an unrelated archived doc
             ^ first 8 characters identical
```

So in a corpus where docs are created in bursts (a wave of tasks filed in one session — the
normal case here), a short ULID prefix is *precisely* the kind of token that feels discriminating
and is not. The collision probability rises with how tightly the docs were created in time, which
is the opposite of the intuition that a random-looking ID is safe to truncate.

A second probe the same session hit the OTHER face again: a full-ULID `grep` over
`lore list --type task --json` returned a hit under default (exclusion-working) conditions,
because the retracted doc's ULID is quoted **inside the `content` field of the fix task that
documents it**. Keyed on the parsed `id` field, the row was correctly absent.

**Corrected remedy, both halves:** compare the **full** ID, and compare it against the **parsed
`id` field**, never against a rendered line or a whole serialized payload. If only a rendered
human column is available, the column is a projection and cannot carry the assertion — read the
`--json` surface instead. Four self-inflicted false positives in one session came from violating
one of those two halves.

## Why this is not a duplicate of the existing lesson

The standing lesson's remedy ("key on lone tokens") is what CAUSED this failure: `RETRACTED` IS a
lone token. Lone-token keying defends against silent no-match and simultaneously opens the
false-positive face. The complete rule needs both halves — a lone token for the signal, plus a
structural anchor and an independent second condition to bound it.

## Residual, named and not fixed

This census exists only because validity is absent from every machine-readable payload. Once
`task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in` lands, the correct census is a
single `--json` read on an explicit validity field, and this whole matcher class disappears from
the path. ⛔ Do not mechanize the grep heuristic — it is scaffolding for a defect that is being
removed, and mechanizing it would outlive its reason.
