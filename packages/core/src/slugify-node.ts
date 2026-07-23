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
 *     `packages/lore/tests/unit/core/barrel-isolation.test.ts` (SPEC-068 AC-068-6).
 *   - **`pinyin-pro` loads LAZILY on first CJK title, never at module load** —
 *     measured cost: ~1s to `import`/`require` the package. A top-level
 *     `import { pinyin } from "pinyin-pro"` would pay that tax on EVERY `lore`
 *     CLI process (this module sits on the CLI's import chain via
 *     `@lore/core/node` → the 4 wired services), including `lore --help` and
 *     pure-ASCII corpora that never hit a CJK title — a real regression for an
 *     agent-facing CLI invoked hundreds of times per session (root-caused via
 *     migrate-phases integration-test timing: 30s→46s under repeated spawns).
 *     `loadPinyin()` below uses `createRequire(import.meta.url)` (pinyin-pro
 *     ships a CJS entry, `package.json#exports["."].require`) to defer that
 *     cost to the FIRST call that actually contains a CJK character, then
 *     caches the resolved function for the lifetime of the process. Only
 *     `import type` (erased at compile time, zero runtime cost) crosses the
 *     module boundary eagerly.
 *   - A title with no Chinese characters (Unicode range U+4E00–U+9FFF, "CJK
 *     Unified Ideographs") short-circuits and returns the input UNCHANGED —
 *     no `pinyin-pro` load OR call at all — this is what keeps existing
 *     ASCII-title slugs byte-identical AND keeps their CLI calls tax-free
 *     (SPEC-068 §Regression stance, AC-068-9).
 *
 * Side-effect class: IO (deliberate deferred module load, see above — despite
 *   living in the "/node" subpath for the SAME reason as the eager-IO modules
 *   it's grouped with, this one's own IO is the lazy `require` call itself,
 *   not filesystem/network access).
 *
 * Consumed by the 4 server-side `slugify` callers (`packages/lore/src/service/`:
 * `corpus-service.ts`, `migration-service.ts`, `export-docs-service.ts`,
 * `phase-migration-service.ts`), each importing `transliterateCjk` from
 * `@lore/core/node` directly (the same precedent `config-service.ts`/
 * `global-config-service.ts` already set for Node-only service-layer imports —
 * no `app.ts` DI wiring needed, these service files are always server-side) and
 * passing it as `slugify(...)`'s `opts.transliterate`.
 *
 * Source: SPEC-068 §Design Decisions D1
 */

import { createRequire } from "node:module";
import type { pinyin } from "pinyin-pro";

/** Matches at least one CJK Unified Ideograph — the trigger for a pinyin-pro load. */
const CJK_CHAR_PATTERN = /[一-鿿]/;

/** The real `pinyin-pro` module's `pinyin` function type — erased at compile time. */
type PinyinFn = typeof pinyin;

/**
 * Process-lifetime cache for the lazily-loaded `pinyin-pro` function.
 * `null` until the first CJK-containing title is seen; never re-required after that.
 */
let cachedPinyinFn: PinyinFn | null = null;

/**
 * Load (once) and return `pinyin-pro`'s `pinyin` function via a CJS `require`,
 * deferred to the first call so pure-ASCII-title callers (and every `lore --help`
 * / non-CJK CLI invocation) never pay the ~1s import cost.
 *
 * @returns The cached (or freshly-required) `pinyin` function.
 */
function loadPinyin(): PinyinFn {
  if (cachedPinyinFn === null) {
    // reason: pinyin-pro ships a CJS entry (package.json#exports["."].require ->
    // ./dist/index.js) — createRequire(import.meta.url) works under Bun/Node ESM
    // without turning this file's OWN module format into CJS. Only `import type`
    // (erased, zero runtime cost) references pinyin-pro at the top of this file;
    // this is the ONE place the real module is loaded, and only on demand.
    const require = createRequire(import.meta.url);
    cachedPinyinFn = (require("pinyin-pro") as { pinyin: PinyinFn }).pinyin;
  }
  return cachedPinyinFn;
}

/**
 * Transliterate the Chinese spans of `text` to tone-less pinyin syllables, leaving
 * every other character (ASCII words, punctuation, other scripts) untouched and in
 * original order.
 *
 * @param text - Raw title text (may be pure ASCII, pure CJK, or mixed).
 * @returns `text` with CJK spans replaced by space-joined pinyin syllables;
 *   returned UNCHANGED when `text` contains no CJK characters (and `pinyin-pro`
 *   is never loaded for that call).
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
  const pinyin = loadPinyin();
  const tokens = pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" });
  return tokens.join(" ");
}
