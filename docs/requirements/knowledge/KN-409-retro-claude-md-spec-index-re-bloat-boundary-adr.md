---
id: KN-409
type: knowledge
role: knowledge
title: "Retro — CLAUDE.md spec-index re-bloat: boundary-ADR drift recurred within 4 days (52.8KB), compressed + entry contract added"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: [claude-md, memory-hygiene, budget]
parent: PRD-001
links:
  - {id: ADR-004, type: relates-to}
---
# Retro — CLAUDE.md spec-index re-bloat: boundary-ADR drift recurred within 4 days

## What happened

`adr-claude-md-carries-only-standing-discipline-histories-archive` (2026-07-22) compressed root CLAUDE.md 164.6KB → 26.7KB and set the boundary: CLAUDE.md carries only timeless standing discipline; histories/narratives go to the corpus. By 2026-07-26 the file was back to **52.8KB**, with the Specs section alone at **33.6KB (64%)** — every session paid ~13k injected tokens for it.

## Root cause

The ADR governed *incident narratives* (dogfood eval rows) but the regrowth came through a different door: **spec close-out habit**. Each spec landing appended a full as-built paragraph (mechanism detail, fix dates, byproducts, helper-function names) to the Specs index in CLAUDE.md — content whose SSOT is already the corpus (`lore get <spec-slug>`, assessments, retros). Same failure mode as the ADR's original context (dual-write → stale, unbounded growth), new ingress path. Prose discipline alone did not hold — consistent with the standing lesson that prose reinforcement measurably fails and invariants need mechanization.

## Fix applied (2026-07-26)

1. Verbose Specs section frozen verbatim into corpus: `knowledge-claude-md-specs-section-as-built-narratives-frozen` (lossless; git history also retains it at commit a636480).
2. Specs section rewritten as one-line-per-spec index (52.8KB → ~28KB total file) with an explicit **entry contract** in the section preamble: one index line per spec, scope keywords only; as-built detail → corpus.
3. New standing lesson added to the Dogfooding section.
4. Mechanization tracked as ad-hoc task: a CLAUDE.md byte-budget check in `hooks/pre-push` (same shape as `lore status --check-prd-budget`), so the third recurrence is caught deterministically instead of by eyeball.

## Lesson

A boundary rule must enumerate its ingress paths. "No incident narratives" did not cover "spec close-out summaries" even though both are the same dual-write anti-pattern. Budget oracles (byte ceilings checked at push time) are ingress-agnostic — they catch ANY regrowth regardless of which habit produced it. This mirrors SPEC-080's PRD budget design: the PRD got a deterministic tiered-budget oracle while CLAUDE.md — with the identical failure mode, twice proven — still relied on prose.

## Where the CLAUDE.md design norm lives (configuration map)

- Norm SSOT: `adr-claude-md-carries-only-standing-discipline-histories-archive` (this corpus) + the entry contract in the CLAUDE.md Specs preamble.
- Cross-project boundary discipline: `~/.claude/CLAUDE.md` (分界 rule — static discipline vs corpus-bound state).
- New-project initial shape: `assets/project/` CLAUDE.md stub installed by `lore setup --project` (marker-section managed, SPEC-060/076).
- Deterministic enforcement: pre-push budget check (pending — see the ad-hoc task).
