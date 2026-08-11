---
id: ADR-013
type: adr
role: decision
title: "CLAUDE.md Specs section is pointer-only — per-spec index lines retired to the corpus"
status: approved
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: [claude-md, memory-files, governance]
parent: PRD-001
links:
  - {id: ADR-004, type: relates-to}
  - {id: KN-409, type: relates-to}
---
# ADR: CLAUDE.md Specs section is pointer-only — per-spec index lines retired to the corpus

## Status
Accepted (owner decision, 2026-07-27)

## Context
The boundary ADR (adr-claude-md-carries-only-standing-discipline-histories-archive, 2026-07-22) cut root CLAUDE.md 164.6KB → 26.7KB. Within 4 days the Specs section re-bloated to 52.8KB via per-spec close-out paragraphs (knowledge-retro-claude-md-spec-index-re-bloat), fixed by an entry contract: ONE index line per spec, scope keywords only.

By 2026-07-27 the entry contract itself had failed structurally, not through discipline breach:

- 73 index lines = 81 lines / 10.4KB — the single largest section, ~35% of the file.
- Root CLAUDE.md sat at 29.9KB, 97% of the 30,720B ceiling about to be enforced by `lore status --check-claude-md` (spec-project-claude-md-content-contract-governance-injected). A linearly growing index against a constant ceiling always intersects; it already had.
- Every session paid ~2.5k tokens for an index whose lines are ~95% irrelevant to any given session (lost-in-middle dilution of the actual standing discipline).
- The index duplicates what the corpus does strictly better: SPEC-084 ordinal addressing (`lore get SPEC-0NN`), FTS5 (`lore search`), enumeration (`lore list --type spec`), 63 specs with code anchors mapping code→spec, and 100 exported grep-able mirrors under `docs/requirements/spec/`.
- The section is a proven narrative-creep attractor: as long as index lines exist, close-outs accrete "one more clause" onto them (observed mechanism of the 52.8KB incident).

## Decision
- The Specs section of root CLAUDE.md is a POINTER ONLY: how to resolve specs from the corpus (ordinal / search / list / exported mirror) plus the read-the-spec-first rule. Zero per-spec lines.
- The one-line-per-spec entry contract is retired. Spec close-outs write NOTHING to CLAUDE.md — no index line, no narrative.
- The 73 removed index lines are NOT archived to a file: they are fully reconstructible from the corpus (spec titles are the keywords) and preserved in git history (removed in the commit referencing this ADR). This differs deliberately from the 2026-07-22 extraction, which archived non-reconstructible narratives.
- The Dogfooding standing lesson "spec close-outs append ONE index line" is superseded by "spec close-outs write nothing to CLAUDE.md".

## Consequences
- Specs section: 81 lines / 10.4KB → ~5 lines; root CLAUDE.md drops to ~2/3 of its byte ceiling with constant (not linear) growth in spec count.
- Discovery cost moves from always-paid injection to one CLI call at need — consistent with the two-tier model (level 1: injected pointer; level 2: on-demand retrieval) already adopted for the claude-md content contract itself.
- Index↔corpus drift becomes structurally impossible (nothing to drift).
- Risk accepted: an agent unaware a governing spec exists must search before editing a module. Mitigations: module CLAUDE.md files carry their governing-spec references (locality), code anchors + `lore status --check-drift` bind code to specs, and the pointer section states the read-the-spec-first rule.
