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

## What Goes In vs What Stays Out

| Category | Example | Home |
|---|---|---|
| Timeless discipline | naming conventions, invariants, `⛔` rules | IN — CLAUDE.md |
| Commands | build / test / lint / dev invocations | IN — CLAUDE.md |
| Invariants | "the store is the source of truth" | IN — CLAUDE.md |
| One-line standing lessons | a terse takeaway, no narrative | IN — CLAUDE.md |
| Index pointers | one line + a link to the real detail | IN — CLAUDE.md |
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

A root CLAUDE.md is organized under exactly these headings, in this order:

1. **What This Is** — a few sentences: what the project does, who consumes
   it.
2. **Commands** — the verbatim build / test / lint / dev invocations. Nothing
   an AI has to guess at.
3. **Architecture** — design intent and the *why* behind key decisions, not a
   file listing and not implementation detail.
4. **Module Index** — see the index-entry contract below.
5. **Finding Live Project State** — how to query the project's own dynamic
   state (its own CLI/API if it has one, or the external system that tracks
   it). Never a snapshot of that state itself.

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
not free-form prose.

## Index-Entry Contract

Every list-like section (Module Index, a specs/decisions index, a standing-
lessons list) follows the same rule: **one line per item, scope keywords
only**. State what the item covers, not what it concluded or how it got
there — that belongs in the corpus doc the line points to. An index entry
that grows past a line is no longer an index entry; split the detail out and
leave the pointer.

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
contract's ceiling half — it walks the repo's memory files, measures lines
and bytes, and reports any file over its ceiling with an exit code a hook can
act on. It is wired into the pre-push check pair. It does not and cannot
judge the content boundary above; that half stays advisory, reviewed by
whoever reads and writes the file.

</claude-md-contract>
