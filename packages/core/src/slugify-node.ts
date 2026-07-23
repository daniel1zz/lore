/**
 * CJK transliteration — pinyin-pro powered, exported ONLY via `@lore/core/node`.
 *
 * Public surface:
 *   - transliterateCjk(text) — Chinese spans -> tone-less, space-joined pinyin
 *     tokens; every other character (ASCII words, punctuation, other scripts)
 *     passes through UNTOUCHED and in original order.
 *
 * Invariants:
 *   - `pinyin-pro` (~931KB unpacked) is a dependency of `@lore/core` but MUST be
 *     UNREACHABLE from the default barrel (`packages/core/src/index.ts`) — this
 *     file is re-exported ONLY from `node.ts` (the `@lore/core/node` subpath),
 *     mirroring the pre-existing `config-node.ts`/`telemetry-node.ts` split
 *     (browser-safety invariant, this package's own CLAUDE.md). `@lore/dashboard`
 *     imports `@lore/core` only and must never reach this file, directly or
 *     transitively. Static import-graph oracle:
 *     `packages/lore/tests/unit/core/barrel-isolation.test.ts` (SPEC-066 AC-066-6).
 *   - Grouped under the "/node" subpath purely for the barrel-isolation boundary
 *     above — this module itself performs no filesystem/network IO; it is a pure
 *     text transform.
 *   - A title with no Chinese characters (Unicode range U+4E00–U+9FFF, "CJK
 *     Unified Ideographs") short-circuits and returns the input UNCHANGED (no
 *     `pinyin-pro` call at all) — this is what
 *     keeps existing ASCII-title slugs byte-identical when this transliterator is
 *     wired in (SPEC-066 §Regression stance, AC-066-9).
 *
 * Side-effect class: Pure (despite living in the "/node" subpath — see above).
 *
 * Consumed by the 4 server-side `slugify` callers (`packages/lore/src/service/`:
 * `corpus-service.ts`, `migration-service.ts`, `export-docs-service.ts`,
 * `phase-migration-service.ts`), each importing `transliterateCjk` from
 * `@lore/core/node` directly (the same precedent `config-service.ts`/
 * `global-config-service.ts` already set for Node-only service-layer imports —
 * no `app.ts` DI wiring needed, these service files are always server-side) and
 * passing it as `slugify(...)`'s `opts.transliterate`.
 *
 * Source: SPEC-066 §Design Decisions D1
 */

import { pinyin } from "pinyin-pro";

/** Matches at least one CJK Unified Ideograph — the trigger for a pinyin-pro call. */
const CJK_CHAR_PATTERN = /[一-鿿]/;

/**
 * Transliterate the Chinese spans of `text` to tone-less pinyin syllables, leaving
 * every other character (ASCII words, punctuation, other scripts) untouched and in
 * original order.
 *
 * @param text - Raw title text (may be pure ASCII, pure CJK, or mixed).
 * @returns `text` with CJK spans replaced by space-joined pinyin syllables;
 *   returned UNCHANGED when `text` contains no CJK characters.
 * @throws Never — `pinyin-pro`'s `pinyin()` does not throw on ordinary input.
 * @example
 *   transliterateCjk("产品定位") // => "chan pin ding wei"
 * @example
 *   transliterateCjk("ADR: internal-circle positioning") // => unchanged (no CJK present)
 * @example
 *   transliterateCjk("ADR: 定位 mixed") // => "ADR:  ding wei  mixed" (ASCII spans verbatim, in order)
 */
export function transliterateCjk(text: string): string {
  if (!CJK_CHAR_PATTERN.test(text)) return text;
  const tokens = pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" });
  return tokens.join(" ");
}
