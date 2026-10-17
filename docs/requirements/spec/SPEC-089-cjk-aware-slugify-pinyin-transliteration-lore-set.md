---
id: SPEC-089
type: spec
role: spec
title: "CJK-aware slugify (pinyin transliteration) + lore set --slug repair path"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-10-17
tags: [slugify, cjk, cli, core]
---
# SPEC-068 — CJK-aware slugify + `lore set --slug` repair path

> Numbering note: authored as "SPEC-066" on 2026-07-23; renumbered to SPEC-068 the same day after a concurrent session merged an unrelated SPEC-066 (git-safety-gate heredoc awareness) and SPEC-067 into main's CLAUDE.md narrative list. AC ids are `AC-068-*` accordingly. (That session's own corpus-only "attestation floor" spec, which briefly also claimed 068, is renumbered to SPEC-069 — main's CLAUDE.md index is the numbering SSOT and it records slugify as 068.)

## Problem

Production dogfooding evidence: `knowledge-slugify-collapses-non-ascii-titles-to-bare-type-prefix` (observed 2026-07-23 in the guyin corpus). Four defects in `packages/core/src/schemas.ts::slugify` and its surrounding surfaces:

1. **CJK collapse**: the kebab step (`/[^a-z0-9]+/g → "-"`) strips every CJK character. An all-Chinese title yields an empty kebab, and line 620's guard returns the bare type name — `lore create adr --title "产品定位：…"` produced slug `adr`. Bare-type slugs are non-descriptive and collision-magnet (`adr-2`, `adr-3`, …). Any Chinese-language team hits this on every doc.
2. **Type-prefix duplication**: a title beginning with the type word ("ADR: internal-circle …") kebabs to `adr-internal-…` and gains the type prefix again → `adr-adr-internal-…`.
3. **Mid-token truncation**: `combined.slice(0, 64)` cuts mid-word (`…-over-compli`).
4. **No repair path**: `lore set` has no `--slug` option; the only fix for a bad slug is delete + recreate (ULID churn, link loss).

## Decision (user-approved 2026-07-23)

- **Primary strategy: pinyin transliteration** via `pinyin-pro` (latest, 3.28.2 at spec time). Chinese spans transliterate to tone-less pinyin tokens; ASCII spans are preserved. `「产品定位：内部圈子使用」` → `adr-chan-pin-ding-wei-nei-bu-quan-zi-shi-yong`.
- **Scope includes `lore set --slug`** as the repair path for existing degenerate slugs.

## Design

### D1 — Transliteration is a pre-kebab step, injected, never in the browser bundle

`pinyin-pro` is ~931 KB unpacked. `schemas.ts` sits in the `@lore/core` barrel closure that `@lore/dashboard` bundles (see core CLAUDE.md browser-safety invariant). Therefore:

- `slugify(type, title, opts?)` gains an optional `opts.transliterate?: (s: string) => string` hook, applied to the raw title BEFORE the kebab step. No hook → current pure-ASCII behavior (plus D3/D4/D5 fixes).
- The pinyin implementation lives OUTSIDE the default barrel — a server-only module (e.g. exported from `@lore/core/node` alongside the existing Node-only splits, or an equivalent non-barrel subpath). `pinyin-pro` becomes a dependency of `packages/core` but MUST be unreachable from `packages/core/src/index.ts`'s transitive import closure.
- All four server-side callers (`corpus-service`, `migration-service`, `export-docs-service`, `phase-migration-service`) pass the transliterator. `slugifyWithCollision` forwards `opts` unchanged.
- Transliteration output tokens: lowercase, tone-less (`toneType: "none"`), hyphen-joined; non-Chinese characters flow through to the kebab step untouched (mixed titles keep their ASCII words).

### D2 — Last-resort deterministic guard: never emit a bare type name

If, after transliteration (when available) and kebab, the name part is still empty (e.g. Korean/kana titles, emoji-only titles, or no transliterator injected), fall back to `{type}-{fnv8}` where `fnv8` = FNV-1a 32-bit hash of the raw title, 8 lowercase hex chars. Deterministic (same title → same slug, referential transparency preserved), zero-dependency, browser-safe. The bare `return prefix` guard at line 620 is retired — `slugify` never returns the naked type name for a non-empty title. Empty/whitespace-only title keeps the current bare-prefix behavior (nothing to hash that a caller could recognize).

### D3 — Type-prefix dedup

After kebab, if the name part equals the type or starts with `{type}-`, strip that leading segment before prefixing (title "ADR: x" → `adr-x`, not `adr-adr-x`). If stripping empties the name part, D2's hash guard applies. Applies to all types (`spec-`, `plan-`, …).

### D4 — Token-boundary truncation

After truncating to 64 chars, cut back to the last complete hyphen-separated token (then trim trailing hyphens, as today). Exception: if the name part's FIRST token alone would overflow, keep the hard character cut (a 64-char single token beats an empty name).

### D5 — `lore set --slug` (service-level, all surfaces inherit)

- `CorpusService.set` accepts a `slug` patch: validate via `slugSchema`, reject when taken by another doc (`VALIDATION_ERROR`, exit 4, message names the holder), no-op when unchanged. Slug change is recorded in the version log like title changes (append-only). Doc `id` (ULID) untouched; the links table keys on ULID so graph edges survive. Free-text slug references in OTHER docs' bodies are NOT rewritten — the CLI success output warns about this.
- CLI: `--slug` added to `lore set`'s declared flags (SPEC-051 strict-flag seam). MCP `lore_set` and HTTP PATCH inherit via the service.
- Status semantics: slug edits do NOT reset an approved doc to draft (unlike title/content) — the slug is an address, not content. Explicitly test this.

### Non-goals

- No retroactive slug rewriting of existing corpus docs (repair is manual via `lore set --slug`).
- No transliteration for non-Chinese scripts (Korean, kana, Cyrillic → D2 hash guard).
- Dashboard write-UI slug editing (server surfaces only this round).

## Regression stance

- Existing ASCII-title slugs must be byte-identical under the new algorithm EXCEPT where D3/D4 intentionally change degenerate outputs (type-word-prefixed titles, mid-token truncations). A golden table pins representative pairs.
- `export-docs` filenames for already-exported docs are pinned by `.lore/export-index.json` (ULID-keyed) and must not churn; only newly exported docs see new-style names.
- Playwright dashboard e2e is the bundle-safety oracle (a pinyin-pro import reaching the barrel would blank the SPA in dev mode; the structural grep AC below is the fast-feedback proxy).


## Acceptance Criteria (structured)

- [⚑] [script] AC-068-1: All-CJK title transliterates to a tone-less pinyin slug: slugify('adr','产品定位：内部圈子使用，功能强大优先于合规保守',{transliterate}) starts with 'adr-chan-pin-ding-wei' and matches slugSchema
  script: test — bunx vitest run packages/lore/tests/unit/core/slugify-cjk.test.ts -t 'AC-068-1'
- [⚑] [script] AC-068-2: Mixed CJK/ASCII title preserves ASCII tokens verbatim and transliterates CJK spans in original order
  script: test — bunx vitest run packages/lore/tests/unit/core/slugify-cjk.test.ts -t 'AC-068-2'
- [⚑] [script] AC-068-3: Title beginning with the type word never duplicates the prefix: slugify('adr','ADR: internal-circle positioning') === 'adr-internal-circle-positioning'
  script: test — bunx vitest run packages/lore/tests/unit/core/slugify-cjk.test.ts -t 'AC-068-3'
- [⚑] [script] AC-068-4: Truncation at 64 chars ends on a complete hyphen-separated token (no mid-token cut) unless the first name token alone exceeds the limit
  script: test — bunx vitest run packages/lore/tests/unit/core/slugify-cjk.test.ts -t 'AC-068-4'
- [⚑] [script] AC-068-5: Non-transliterable non-empty title (Korean/kana/emoji, or no transliterator injected) yields deterministic '{type}-{fnv8hex}' — slugify never returns the bare type name for a non-empty title
  script: test — bunx vitest run packages/lore/tests/unit/core/slugify-cjk.test.ts -t 'AC-068-5'
- [⚑] [script] AC-068-6: pinyin-pro is unreachable from the @lore/core default barrel: static import-graph scan of packages/core/src/index.ts transitive closure finds 0 pinyin-pro imports
  script: test — bunx vitest run packages/lore/tests/unit/core/barrel-isolation.test.ts
- [⚑] [script] AC-068-7: lore set --slug renames: new slug resolves, old slug returns DOC_NOT_FOUND, version log gains an entry, links (ULID-keyed) survive, and an approved doc does NOT reset to draft
  script: test — bunx vitest run packages/lore/tests/unit/service/set-slug.test.ts -t 'AC-068-7'
- [⚑] [script] AC-068-8: set --slug rejects with VALIDATION_ERROR (CLI exit 4) when the slug is taken by another doc (message names the holder) or fails slugSchema; unchanged slug is a no-op
  script: test — bunx vitest run packages/lore/tests/unit/service/set-slug.test.ts -t 'AC-068-8'
- [⚑] [script] AC-068-9: Golden regression table: representative ASCII titles produce byte-identical slugs to the pre-change algorithm (except documented D3/D4 degenerate cases)
  script: test — bunx vitest run packages/lore/tests/unit/core/slugify-cjk.test.ts -t 'AC-068-9'
- [⚑] [script] AC-068-10: Compiled-binary e2e: freshly built dist/lore, run from a temp corpus OUTSIDE the repo (no node_modules), creates an all-CJK-title doc whose slug is pinyin (starts with the type prefix + first pinyin token), exit 0
  script: test — bunx --bun vitest run packages/lore/tests/integration/cli/slugify-compiled.bun.test.ts
