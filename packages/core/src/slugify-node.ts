/**
 * CJK transliteration — pinyin-pro powered, exported ONLY via `@lore/core/node`.
 *
 * Public surface:
 *   - getTransliterateCjk() — returns (cached, process-lifetime) a Promise of a
 *     sync transliterator: Chinese spans -> tone-less, space-joined pinyin
 *     tokens; every other character (ASCII words, punctuation, other scripts)
 *     passes through UNTOUCHED and in original order. ASCII-only input is
 *     returned unchanged by the resolved function with NO dictionary work
 *     (the CJK-presence short-circuit lives inside the returned closure, not
 *     just at the caller).
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
 *   - **`pinyin-pro` loads via a STATIC-SPECIFIER dynamic `import()`, never
 *     `createRequire(...)("pinyin-pro")` (SPEC-068 hotfix, 2026-07-23)** — the
 *     original implementation used `createRequire(import.meta.url)` to defer
 *     the CJS `require` to first-CJK-title call. That measurably breaks under
 *     `bun build --compile`: a compiled `dist/lore` run OUTSIDE the repo (no
 *     `node_modules` reachable from `$bunfs/root`) threw
 *     `Cannot find package 'pinyin-pro' from '/$bunfs/root/index.js'` on every
 *     CJK-title `lore create` — none of the pre-hotfix ACs exercised the
 *     COMPILED artifact, only source mode (`bun run dev`). Probe-verified fix:
 *     a `await import("pinyin-pro")` with the specifier as a literal string
 *     (never a template/variable — bun's bundler statically discovers and
 *     bundles literal-specifier dynamic imports at `bun build --compile` time,
 *     the same way it bundles static top-level imports) loads correctly from
 *     the compiled binary — measured ~29ms in compiled form (vs ~978ms in
 *     source mode, where esbuild/bun's dev resolver still has to walk
 *     `node_modules`). See `packages/lore/tests/integration/cli/slugify-compiled.bun.test.ts`
 *     (AC-068-10) for the compiled-binary regression oracle. NO silent
 *     fallback: if the dynamic import rejects, `getTransliterateCjk()`'s
 *     returned promise rejects — callers never receive a no-op identity
 *     transliterator standing in for a broken pinyin-pro load.
 *   - **The import is still deferred, not paid by every `lore` process** — the
 *     original startup-tax rationale is unchanged, only the loading mechanism
 *     changed. `getTransliterateCjk()` is a plain async function; nothing
 *     invokes `import("pinyin-pro")` until a caller actually calls it. The 4
 *     server-side callers (below) gate that call on the title actually
 *     containing a CJK character (`containsCjk`, exported below) so a
 *     pure-ASCII-title `lore` invocation — including `lore --help` and every
 *     non-CJK corpus write — never pays the import cost at all.
 *   - A title with no Chinese characters (Unicode range U+4E00–U+9FFF, "CJK
 *     Unified Ideographs") short-circuits and returns the input UNCHANGED
 *     inside the resolved transliterator function — this is what keeps
 *     existing ASCII-title slugs byte-identical even if a caller ever calls
 *     `getTransliterateCjk()` unconditionally (SPEC-068 §Regression stance,
 *     AC-068-9).
 *
 * Side-effect class: IO (deliberate deferred module load via dynamic `import()`).
 *
 * Consumed by the 4 server-side `slugify` callers (`packages/lore/src/service/`:
 * `corpus-service.ts`, `migration-service.ts`, `export-docs-service.ts`,
 * `phase-migration-service.ts`), each importing `getTransliterateCjk` (+
 * `containsCjk`) from `@lore/core/node` directly (the same precedent
 * `config-service.ts`/`global-config-service.ts` already set for Node-only
 * service-layer imports — no `app.ts` DI wiring needed, these service files
 * are always server-side), calling `await getTransliterateCjk()` ONLY when the
 * title contains CJK, and passing the resolved sync function as
 * `slugify(...)`'s `opts.transliterate`.
 *
 * Source: SPEC-068 §Design Decisions D1; hotfix task
 * task-hotfix-spec-068-pinyin-lazy-load-must-survive-bun-compile
 */

import type { pinyin } from "pinyin-pro";

/** Matches at least one CJK Unified Ideograph — the trigger for a pinyin-pro load. */
const CJK_CHAR_PATTERN = /[一-鿿]/;

/** The real `pinyin-pro` module's `pinyin` function type — erased at compile time. */
type PinyinFn = typeof pinyin;

/**
 * Reports whether `text` contains at least one CJK Unified Ideograph.
 *
 * Callers use this to decide whether it's worth calling `getTransliterateCjk()`
 * at all — a pure-ASCII title never needs the pinyin-pro load.
 *
 * @param text - Text to test.
 * @returns `true` iff `text` contains a CJK Unified Ideograph.
 * @example
 *   containsCjk("产品定位") // => true
 *   containsCjk("internal-circle") // => false
 */
export function containsCjk(text: string): boolean {
  return CJK_CHAR_PATTERN.test(text);
}

/**
 * Process-lifetime cache: the single in-flight/resolved promise behind
 * `getTransliterateCjk()`. `null` until the first call; every subsequent call
 * (concurrent or sequential) returns the SAME promise — the dynamic import
 * happens at most once per process.
 */
let cachedTransliterateCjkPromise: Promise<(text: string) => string> | null = null;

/**
 * Load (once, process-lifetime-cached) `pinyin-pro` via a static-specifier
 * dynamic `import()` and return a sync transliterator built on top of it.
 *
 * The returned function transliterates the Chinese spans of its input to
 * tone-less pinyin syllables, leaving every other character (ASCII words,
 * punctuation, other scripts) untouched and in original order; it returns
 * ASCII-only input UNCHANGED with no dictionary lookup at all.
 *
 * @returns A promise of the cached (or freshly-loaded) sync transliterator.
 * @throws Never synchronously — if the dynamic import itself rejects (e.g.
 *   `pinyin-pro` genuinely unresolvable), the RETURNED PROMISE rejects. There
 *   is no silent fallback to an identity transliterator; a caller awaiting
 *   this must let that rejection propagate, not swallow it into a bare-slug
 *   result.
 * @example
 *   const transliterate = await getTransliterateCjk();
 *   transliterate("产品定位") // => "chan pin ding wei"
 *   transliterate("ADR: internal-circle positioning") // => unchanged (no CJK present)
 *   transliterate("ADR: 定位 mixed") // => "ADR:  ding wei  mixed" (ASCII spans verbatim, in order)
 */
export function getTransliterateCjk(): Promise<(text: string) => string> {
  if (cachedTransliterateCjkPromise === null) {
    // reason: the specifier below MUST stay a literal string, never a
    // template/variable — bun's bundler only discovers and inlines
    // literal-specifier dynamic imports at `bun build --compile` time. A
    // computed specifier falls back to a runtime module resolution that
    // cannot find `pinyin-pro` inside the compiled binary's virtual
    // `$bunfs/root` filesystem (the exact defect this hotfix fixes — see
    // this file's module header). SPEC-068 hotfix, probe-verified 2026-07-23.
    cachedTransliterateCjkPromise = import("pinyin-pro").then((mod) => {
      const pinyinFn = mod.pinyin as PinyinFn;
      return (text: string): string => {
        if (!CJK_CHAR_PATTERN.test(text)) return text;
        const tokens = pinyinFn(text, { toneType: "none", type: "array", nonZh: "consecutive" });
        return tokens.join(" ");
      };
    });
  }
  return cachedTransliterateCjkPromise;
}
