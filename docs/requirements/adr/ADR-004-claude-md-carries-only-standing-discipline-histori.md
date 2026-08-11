---
id: ADR-004
type: adr
role: decision
title: "CLAUDE.md carries only standing discipline — histories archive to docs/claude-md-archive + lore corpus"
status: approved
priority: medium
created: 2026-07-22
updated: 2026-07-26
tags: []
parent: PRD-001
---
# ADR: CLAUDE.md carries only standing discipline — histories archive out

## Status
Accepted (owner directive, 2026-07-22)

## Context
The repo root CLAUDE.md had grown to 164.6KB (~40k tokens injected EVERY session): a 33-row dogfood eval-log table (52KB) and 30 per-spec implementation paragraphs (78KB) accumulated inline. Both are reference-grade historical narratives, not per-session working rules. The same session also proved status narratives in CLAUDE.md go stale silently: the global CLAUDE.md carried a "resolved-actor advisory: recommended twice, NOT built" note while the mechanism had already shipped (SPEC-035 hotfix, commit fe98b1b) — and the compressed file's own first draft reproduced the same defect (a "not mechanized" claim outdated by same-day work), caught by an independent reviewer pass.

## Decision
A hard boundary between the memory surfaces:

- **CLAUDE.md (root + global)**: ONLY timeless standing discipline — rules, prohibitions, thresholds, paths, commands, one-line standing lessons. Never full incident narratives, never mutable status ("not yet built", "pending", "escalated").
- **lore corpus**: the SOLE destination for new events, incidents, retros, decisions, status, anything dated — `lore create knowledge --sub-type retro` / `lore create adr`. Searchable, invalidatable SSOT for history.
- **docs/claude-md-archive/**: a FROZEN byte-exact snapshot of the pre-2026-07-22 inlined history (dogfood-eval-log.md, spec-implementation-notes.md). Git-tracked and grep-able, but receives NO new content (owner decision: freezing avoids dual-write drift; the "always-in-context" rationale for a single table died with the externalization).

New-finding flow (codified in CLAUDE.md's Dogfooding section): lore knowledge doc ONLY → at most a one-line standing lesson in CLAUDE.md.

Backfill decision (owner, 2026-07-22): the 26 archived eval rows without corpus knowledge docs are NOT backfilled — most are closed loops (FIXED/mechanized); the archive remains their retrieval surface (grep), keeping lore search signal-to-noise high.

## Consequences
- Root CLAUDE.md: 164.6KB → ~26.7KB (-84%), ~40k → ~6.6k tokens per session; global ~/.claude/CLAUDE.md: 18.9KB → 13.3KB (-30%).
- Zero information loss: every removed line was moved with scripted byte-exact extraction + containment assertions (33 eval rows, 30 spec paragraphs, 86 Implementation Status lines).
- Spec detail SSOT remains the corpus (`lore get <spec-slug>`); the archive holds the implementation-time summaries formerly inlined.
- Compression-fidelity risk was mitigated by an independent reviewer comparing every index line against archived paragraphs (3 findings, all fixed; 30/30 index lines otherwise faithful).
- Residual risk accepted: archive-only history is grep-only (not in `lore search`); if a frozen row's lesson regains relevance, promote it to a corpus knowledge doc at that time.
