<!-- lore claude-md-contract governance snippet · versioned with the lore binary · served by `lore governance claude-md` -->
<claude-md-contract>

# CLAUDE.md Content Contract

Two normative levels apply to every CLAUDE.md (and equivalent memory file) in a
lore-governed repo. They are deliberately different in strength — read both
before writing or editing one.

## Target vs Ceiling — read this first

- **Target (advisory, official)** — Anthropic's own guidance is to keep each
  memory file under two hundred lines
  ([S] code.claude.com/docs/en/memory.md). Aim for this. It is a design goal,
  not something a machine enforces on you.
- **Ceiling (deterministic, enforced)** — a separate, looser hard limit on
  lines and bytes exists so the check does not fail most repos on first
  install. It is enforced at push time and reported by `lore status
  --check-claude-md`. Run that command to see the effective ceiling values
  for this repo — this contract never repeats them in prose. Ceiling numbers
  live in exactly one place (config), and prose citing them a second time is
  a dual-write defect waiting to drift, so this document does not.

The target keeps files readable during authoring. The ceiling is the
last-resort backstop that catches runaway re-bloat when authoring discipline
lapses. Passing the ceiling check is not the same as meeting the target —
treat every ceiling pass as a prompt to look again, not a clean bill of
health.

## The Eviction Rule — what happens as a file fills up

Every metric has **three bands**, not two. `lore status --check-claude-md`
prints which band each file is in, and the two band boundaries are config
values — as with the ceiling, this contract does not repeat the numbers.

| Band | Signal | Who acts |
|---|---|---|
| Below the advisory threshold | silent | nobody |
| Advisory (approaching) | a warning; exit code unaffected | whoever is editing, at their discretion |
| At or past the **eviction floor** | a deterministic finding; non-zero exit | **the author of the edit that trips it, in that same change** |
| Over the ceiling | a deterministic breach; non-zero exit | same, but you are now out of room |

**The eviction floor is an obligation, not a notification.** It fails the
check, the pre-push hook, and the post-edit guard. It fires while the file is
still *writable*, on purpose: you can land the entry you came to write and
then evict, so you are never forced to choose between blocking and putting
the fact somewhere it does not belong.

**Why a third band exists at all.** An advisory nobody is obligated to act on
does not get acted on. Measured on this repo: four module files sat in the
advisory band for an unknown number of sessions and the count went *up*, not
down; one of them had been compressed to two-thirds of its ceiling ten days
earlier. When a file reaches zero runway, the guard blocks the one *correct*
write — recording a module's own fact in that module's own file — so the fact
gets recorded in a *neighbouring* file instead, where nothing reports it as
misplaced. That is a silent SSOT violation manufactured by the budget itself.

### How to evict

1. Pick a block that the table above already assigns to the corpus —
   mechanism walkthroughs, per-change narratives, measurements, rejected
   alternatives. Not the rule it illustrates.
2. Move it, verbatim, into a corpus doc
   (`lore create knowledge --sub-type reference`).
3. Leave **one line** in the memory file: what was evicted, and the slug
   that now holds it. That pointer must resolve — a pointer to a doc that
   does not exist is the same defect class as a dangling code anchor.
4. Keep the rule, drop the story. If a block is load-bearing discipline,
   compress it to the ⛔ rule and evict the narrative that motivated it.
5. **The stub IS an index entry.** It answers to the Index-Entry Contract
   (below) the same as any other list line: one line, scope keywords only,
   no restated conclusion. A "one line" that grew back into a paragraph
   still carrying the measurement it was meant to evict has not evicted
   anything — it has only renamed the place the fact sits. Measured on
   this repo's own root file: 21 eviction stubs on record, several of them
   multi-line paragraphs still holding the numbers they were supposed to
   leave behind.

### What is never the fix

- ⛔ **Do not raise the ceiling or the floor.** The ceiling exists because an
  unbounded memory file is itself the failure mode; raising it converts a
  loud block into a slow silent regression.
- ⛔ **Do not split a line only to reduce the reported LINE COUNT.** Bytes
  are the binding ceiling (Target vs Ceiling, above) — splitting one line
  into two adds a newline byte and reduces nothing the ceiling actually
  measures. Measured on this repo's own root file: 121 bytes/line average,
  1529 bytes at the longest line, and climbing, while the 200-line target
  keeps reading as "met." Line count and byte count are measured
  independently; only the byte count binds.
- This does not forbid the separate, advisory `line_length` signal `lore
  status --check-claude-md` reports per file. A genuinely long line is hard
  to scan, and that signal exists to flag it — it reports the line, it does
  not license reflowing it in place to game the count above. Shortening a
  line by moving its content elsewhere is fine; splitting it in place to
  lower the line count is the thing this rule forbids.
- ⛔ **Do not record the fact in another module's file.** A module's own
  facts belong in that module's own file. Displacement is invisible to every
  check here — the check measures saturation, never relocation — so it is
  the one failure this mechanism cannot catch for you.
- ⛔ **Do not disable the check for the file you are editing.** The opt-out
  is global and deliberate; there is no per-file exemption.

## Path-Scoped Rules — `.claude/rules/`

A memory file that outgrows its budget has a second destination besides the
corpus: Anthropic's own documented remedy is a path-scoped rule file ([S]
code.claude.com/docs/en/memory.md — "use path-scoped rules so instructions
load only when Claude works with matching files").

- Rule files live at `.claude/rules/*.md`, one topic per file — this is a
  second home for narrow, file-type-specific guidance, not a second dumping
  ground for whatever no longer fits above.
- `paths:` YAML frontmatter scopes a rule so it loads **only** when Claude
  reads a file matching that glob. That scoping is what makes a rule
  cheaper than an `@import` or another CLAUDE.md paragraph: a session that
  never touches the matching paths never pays for the rule at all.
- A rule with **no** `paths:` frontmatter loads every session, at the same
  priority as `.claude/CLAUDE.md` — moving a block there without adding
  `paths:` is not a cheaper home, it is the same cost under a new filename.
- `~/.claude/rules/` is the user-level equivalent, scoped the same way.
- Rules vs. skills: a rule is resident (whole-session if unscoped) or
  path-triggered; a skill loads only on invocation. A fact a given file
  type needs every time it is touched belongs in a rule; a multi-step
  procedure an agent runs on demand belongs in a skill.

⛔ Moving a block to `rules/` counts as an eviction only if the destination
is itself budgeted. An unscoped rule, or a scoped rule nobody measures, just
relocates the bloat this contract's Eviction Rule already names as the
failure mode — the content still loads, still costs, and now nothing here
reports it.

## Content Tiers — what every session pays for

Every piece of guidance lives on exactly one tier. The root CLAUDE.md is
tier 1 and nothing else: every session loads it whole, whatever files it
touches, so every byte in it is paid by every session.

| Tier | Loaded | Holds | Home |
|---|---|---|---|
| 1 | every session, always | what to do and what never to do — no *why* | root CLAUDE.md, unscoped rules |
| 2 | on demand, when an agent goes deeper | design intent, the *why*, mechanism walkthroughs, rejected alternatives, module-specific facts | module CLAUDE.md (path-triggered), `paths:`-scoped rules, skills, corpus ADR / spec / knowledge |
| 3 | only when investigating | full specs, incident histories, measurements | corpus, the code itself |

A line belongs on tier 1 only when ALL three hold:

1. Almost every session needs it, whatever files it touches.
2. Not knowing it causes damage that no gate, hook or check refuses.
3. It cannot be recovered from the code or the corpus in seconds.

Fail any one and the content moves down a tier; tier 1 keeps at most one
pointer line naming where it went (an index entry, see the Index-Entry
Contract). A tier-1 line states the rule, never the reasoning: the reasoning
is tier 2 and is read by the agent that needs to change the rule, not by
every agent that must obey it.

## What Goes In vs What Stays Out

| Category | Example | Home |
|---|---|---|
| Timeless discipline | naming conventions, invariants, `⛔` rules | IN — CLAUDE.md |
| Commands | build / test / lint / dev invocations | IN — CLAUDE.md |
| Invariants | "the store is the source of truth" | IN — CLAUDE.md |
| One-line standing lessons | a terse takeaway, no narrative | IN — CLAUDE.md |
| Index pointers | one line + a link to the real detail | IN — CLAUDE.md |
| Design intent and rationale | why a decision was made, what it trades off | OUT — tier 2 (corpus ADR, module CLAUDE.md); one pointer line in |
| Mechanism walkthroughs | how a subsystem works internally | OUT — tier 2 (module CLAUDE.md or corpus reference) |
| Module-local facts | a store's escaping rule, one service's contract | OUT — that module's own CLAUDE.md |
| Events | "fixed on a given date", incident timestamps | OUT — corpus (knowledge / retro) |
| Status narratives | "phase N is underway", sprint state | OUT — corpus (plan / task) |
| Full incident histories | postmortems, root-cause writeups | OUT — corpus (knowledge / retro) |
| Code-derivable facts | function signatures, file listings | OUT — the code itself (read / grep it) |
| API docs | full endpoint or parameter catalogs | OUT — code or a dedicated doc |

If content changes faster than roughly once a month, or a human/AI could
recover it from the code in a few seconds, it does not belong in a memory
file. If it stopped being true yesterday, it is an event, not discipline —
send it to the corpus.

## Root CLAUDE.md — five-section taxonomy

A root CLAUDE.md must contain these H2 headings verbatim, in this order. Other
H2 sections may appear anywhere around them (reported as advisory only, never
as a failure):

1. **What This Is** — a few sentences: what the project does, who consumes
   it.
2. **Commands** — the verbatim build / test / lint / dev invocations. Nothing
   an AI has to guess at.
3. **Architecture** — the repo-wide invariants every change must keep, one
   line each, stated as rules (tier 1). The design intent and the *why*
   behind them are tier 2: a pointer line to the ADR or module file, never
   the reasoning inline. Not a file listing, not implementation detail, not
   a fact only one module needs.
4. **Module Index** — see the index-entry contract below.
5. **Finding Live Project State** — how to query the project's own dynamic
   state (its own CLI/API if it has one, or the external system that tracks
   it). Never a snapshot of that state itself.

## Adoption Mode

`context.memory_files.adoption` in `.lore/config.yaml` decides whether
deterministic memory-file findings (including a missing or out-of-order root
section) block, or only warn. It takes two values:

- **enforce** — findings are deterministic: `lore status --check-claude-md`
  exits non-zero and the pre-push hook refuses the push.
- **warn** — the same findings are downgraded to advisory: the exit code is
  unaffected, each is listed as `[downgraded:<kind>]`, and every warn run
  prints a summary line starting `WARN adoption=warn`.

An absent value resolves to **warn**, so an existing repo is never broken by
upgrading. `lore setup` writes the value explicitly, so a fresh install states
its mode instead of inheriting the default. `lore bootstrap` and
`lore status --json` expose the resolved mode, where it came from, how many
findings were downgraded, and a `promotable` flag. A repo is promotable when
it is in warn mode and has zero would-be deterministic findings; once
promotable, switch the config value to enforce so the structure stays held.

## Module CLAUDE.md — file taxonomy

A per-module CLAUDE.md (one directory below root, not recursive) covers:

- **Purpose** — one or two sentences: what this module does, where its
  boundary sits.
- **Key Invariants** — constraints that must hold; what you would tell a
  newcomer before they touch this code. Omit if the module genuinely has
  none.
- Module-specific conventions (patterns, registration order, cross-module
  links) — only what differs from or extends the root file. Link to sibling
  module files instead of duplicating their content.

This mirrors the root taxonomy's shape: a short, verifiable set of headings,
not free-form prose. The Content Tiers rule applies one level down: a module
file is loaded whole whenever its directory is touched, so it holds what
every edit there needs; the *why* behind a module invariant goes to the
corpus with a pointer line.

## Index-Entry Contract

Every list-like section (Module Index, a specs/decisions index, a standing-
lessons list) follows the same rule: **one line per item, scope keywords
only**. State what the item covers, not what it concluded or how it got
there — that belongs in the corpus doc the line points to. An index entry
that grows past a line is no longer an index entry; split the detail out and
leave the pointer.

An eviction stub (the one line the Eviction Rule leaves behind) is a member
of this rule, not an exception to it — the same "one line, scope keywords
only" shape applies whether the line indexes a corpus doc or a module file.

## Style Guidance

- Write rules concrete enough that another agent could verify them with a
  command — vague adjectives ("clean", "robust") are not discipline, they are
  an invitation to disagree later.
- If a rule describes an action that must run every time (a check, a format
  pass, a gate), it belongs in a hook, not in prose. Prose can be skipped by
  an agent under pressure; a hook cannot.
- Push knowledge that is only needed occasionally into per-directory
  CLAUDE.md files or skills, loaded on demand, rather than inflating the root
  file that every session pays for.
- Prefer one concrete example over three abstract rules.

## Enforcement

`lore status --check-claude-md` is the deterministic oracle for this
contract's budget half — it walks the repo's memory files, measures lines and
bytes, and reports every file over its ceiling **or past its eviction floor**
with an exit code a hook can act on. It is wired into the pre-push check pair
and into the post-edit guard, so a memory-file edit that trips either
boundary is reported at the moment it happens, not at review time.

It does not and cannot judge the content boundary above, and it cannot detect
**displacement** — a fact recorded in the wrong module's file measures as
perfectly healthy on both files. That half stays advisory, reviewed by whoever
reads and writes the file. When you are blocked from adding to a file, the
question to ask is "what should leave this file", never "where else could this
go".

</claude-md-contract>
