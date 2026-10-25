---
id: SPEC-205
type: spec
role: spec
title: "Module index lists only folders with a memory file; managed zone carries the template headings; legacy auto blocks migrate once"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-19
tags: []
---
## Overview/Goal

`lore context refresh` cannot run on this repository (CL-7, measured 2026-10-18): it would splice a 251-line managed zone into the 78-line root CLAUDE.md (329 > 220-line ceiling, refused by BR-887). Cause: the module index lists every non-hidden folder at any depth, 200 of 209 entries reading "no memory file yet" — incidental code behaviour recorded as BR-882 (unconfirmed); the governing spec (spec-context-verb-family-two-zone-claude-md-anatomy-lore, "Two-Zone File Anatomy") calls the index "existence-checked links", and `lore governance claude-md` requires index entries of one line with scope keywords and module files one directory below root. Two further defects: refresh's managed zone emits no `## Module Index` / `## Finding Live Project State` headings although the setup template's managed block carries them (spec-claude-md-root-section-structure-check-and-adoption-mode D4), so a set-up repository loses both headings on refresh and enforce mode refuses it; and legacy `auto:module-index` / `auto:dynamic-context` blocks are treated as hand text, so refresh appends a second index. BR-882 also drops folders past the entry limit without notice.

End state: the module index lists only folders that have their own memory file, each as a link plus the first sentence of that file's Purpose section; folders without one are counted in one line, never listed; nothing is dropped silently. The managed zone emits the same H2 headings as the setup template. Legacy auto blocks are recognised and replaced by the managed zone once, reported by name in refresh's output.

## Scope

In scope: the module-index discovery and rendering (context-facts.ts, context-flow.ts), managed-zone headings, legacy auto-block migration, rule BR-882 modified, `lore context refresh --check` (computes the refresh, writes nothing, exits 1 naming each file that would change or a ceiling breach — so an oracle can assert the refreshed state without editing tracked files in a shared checkout), and this repository's root CLAUDE.md refreshed once within its ceiling.
Out of scope: the command table, governance and spec-discovery pointers (unchanged).

## Acceptance Criteria

AC-MI-1..3 (`lore ac add`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-MI-1: MODULE INDEX = EXISTING MEMORY FILES ONLY, NOTHING DROPPED SILENTLY. Throwaway project with 3 folders carrying a memory file (each with a Purpose section) and 40 without: refresh writes exactly 3 index lines, each a link to the memory file plus the first sentence of its Purpose, and no count line; `lore context refresh --check` reports the count 40 (plain text, and check.modulesWithoutMemoryFile in --json); a memory file without a Purpose section is listed with its link and the text 'no Purpose section' (never skipped); a hidden or ignored folder holding a memory file is not listed (AC-CTX-9 regression).
  script: test — bunx --bun vitest run packages/lore/tests/integration/context-module-index.test.ts -t 'AC-MI-1' && echo 'AC-MI-1 PASS: index lists only folders with a memory file and counts the rest'
  other_command=1
- [⚑] [script] AC-MI-2: HEADINGS AND LEGACY BLOCKS. (1) In a throwaway project set up with lore setup (managed block from the template), lore context refresh keeps '## Module Index' and '## Finding Live Project State' and lore status --check-claude-md exits exactly 0 reporting no section_missing; (2) a CLAUDE.md holding auto:module-index and auto:dynamic-context blocks: refresh replaces them with one managed zone (exactly one '## Module Index' heading in the file), prints each migrated block by name, and leaves every byte of hand-written text outside those blocks unchanged.
  script: test — bunx --bun vitest run packages/lore/tests/integration/context-module-index.test.ts -t 'AC-MI-2' && echo 'AC-MI-2 PASS: managed zone keeps the template headings; legacy auto blocks migrate once, reported'
  other_command=1
- [⚑] [script] AC-MI-3: THIS REPOSITORY IS IN REFRESHED STATE WITHIN ITS CEILING, CHECKED WITHOUT WRITING. lore context refresh --check computes the refresh, writes nothing, and exits 0 only when every target (root CLAUDE.md, rendered rules files) already equals its refreshed content and the root CLAUDE.md is within the configured ceiling (.lore/config.yaml); otherwise it exits exactly 1 naming each differing file (or the ceiling). Throwaway project: a stale CLAUDE.md -> exit 1 naming it, file bytes unchanged; after a real refresh -> exit 0. On main (after the one-time refresh this spec's implementation lands): exit 0, and lore governance claude-md --check exits 0.
  script: other — lore context refresh --check && lore status --check-claude-md && echo 'AC-MI-3 PASS: root CLAUDE.md is refreshed, within its ceiling and passes the section check'
  other_command=2
