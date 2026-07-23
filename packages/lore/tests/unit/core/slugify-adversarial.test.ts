/**
 * Adversarial six-dimension sweep for SPEC-068's CJK-aware `slugify` (D1-D4),
 * covering gaps NOT exercised by `slugify-cjk.test.ts` (AC-068-1..5, AC-068-9)
 * or `barrel-isolation.test.ts` (AC-068-6): polyphonic CJK disambiguation,
 * CJK-punctuation-only titles, CJK+emoji mixes, exact 63/64/65-char boundary
 * cuts, D3-exact-type-word-match -> D2 chain, hash-source correctness (raw
 * title, never the transliterated string), throwing transliterators, and
 * nullish-title crash behavior.
 *
 * All golden expected values are derived from an INDEPENDENT re-derivation:
 *   - Pinyin transliterations were obtained by invoking the REAL `pinyin-pro`
 *     package directly (`pinyin(text, {toneType:"none", type:"array",
 *     nonZh:"consecutive"})`) in a throwaway scratch script OUTSIDE this test
 *     file and outside `slugify-node.ts` — never by running `slugify()` under
 *     test and copying its output.
 *   - The kebab/D3/D4 boundary-cut arithmetic was hand-derived from SPEC-068's
 *     documented D2-D4 rules (English prose, `schemas.ts`'s `slugify` JSDoc)
 *     using controlled fixed-length token titles, then cross-checked with a
 *     second throwaway script reproducing only the documented RULE TEXT (not
 *     copy-pasted from `schemas.ts`), discarded after use.
 *   - `fnv1a32Hex` is imported directly as an independent hash oracle to
 *     compute expected D2 fallback values — this checks the INTEGRATION
 *     between `slugify`'s D2 branch and the hash function it's specified to
 *     call, not `slugify`'s own internals.
 *
 * Runner: vitest (no `bun:sqlite`).
 * @spec_ref SPEC-068
 */

import { describe, it, expect, beforeAll } from "vitest";
import { slugify, slugSchema, type DocType } from "@lore/core";
import { getTransliterateCjk } from "@lore/core/node";

/**
 * Independent re-implementation of the D2 fallback hash (FNV-1a 32-bit,
 * offset basis 0x811c9dc5, prime 0x01000193, 8 lowercase hex chars) — written
 * from `slug-hash.ts`'s documented ALGORITHM DESCRIPTION (not imported from
 * it; `fnv1a32Hex` isn't exported from the `@lore/core` barrel, and importing
 * the source file directly across the package boundary breaks
 * `tsconfig.tests.json`'s `rootDir`). Used only as an oracle to compute
 * EXPECTED D2 values for the raw title being hashed — this checks the
 * integration between `slugify`'s D2 branch and the hash it's specified to
 * produce, not `slugify`'s own internals.
 */
function fnv1a32Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

describe("slugify — SPEC-068 adversarial sweep", () => {
  // `getTransliterateCjk()` is async (SPEC-068 hotfix 2026-07-23 — dynamic
  // `import("pinyin-pro")`, compile-safe under `bun build --compile`, replacing
  // the prior `createRequire` form); resolve the cached sync transliterator
  // once, then pass it into `slugify`'s sync `opts.transliterate` hook the same
  // way every production caller does. Zero assertion changes below — this is
  // purely the async-getter migration mirroring `slugify-cjk.test.ts`.
  let transliterateCjk: (text: string) => string;
  beforeAll(async () => {
    transliterateCjk = await getTransliterateCjk();
  });

  // ─── HAPPY: polyphonic CJK disambiguation (beyond AC-068-1/2) ────────────

  describe("polyphonic CJK characters — context-dependent readings, not naive per-char lookup", () => {
    it("重庆 (Chongqing) transliterates '重' as 'chong', not the isolated-character reading 'zhong'", () => {
      const result = slugify("adr", "重庆", { transliterate: transliterateCjk });
      expect(result).toBe("adr-chong-qing");
      expect(slugSchema.safeParse(result).success).toBe(true);
    });

    it("长沙 (Changsha) transliterates '长' as 'chang', not the alternate reading 'zhang'", () => {
      const result = slugify("adr", "长沙", { transliterate: transliterateCjk });
      expect(result).toBe("adr-chang-sha");
    });

    it("the same character standalone reads differently by context ('重' alone vs inside '重庆')", () => {
      const standalone = slugify("knowledge", "重", { transliterate: transliterateCjk });
      const inWord = slugify("knowledge", "重庆", { transliterate: transliterateCjk });
      // Standalone "重" reads "zhong"; inside "重庆" it reads "chong" — if the
      // implementation naively mapped each character in isolation (a
      // context-blind per-char table) these would produce the SAME first
      // syllable. They must not.
      expect(standalone).toBe("knowledge-zhong");
      expect(inWord.startsWith("knowledge-chong")).toBe(true);
      expect(standalone.split("-")[1]).not.toBe(inWord.split("-")[1]);
    });
  });

  // ─── HAPPY: CJK punctuation-only and CJK+emoji mixes (beyond AC-068-5) ───

  describe("CJK-adjacent scripts the transliterator does not cover", () => {
    it("a title of ONLY CJK punctuation (no Han ideographs) never calls into pinyin — falls straight to the D2 hash guard", () => {
      const title = "《》，。！？：；";
      const result = slugify("adr", title, { transliterate: transliterateCjk });
      // No CJK Unified Ideograph present (these are punctuation code points,
      // not U+4E00-U+9FFF) — transliterateCjk's own short-circuit means the
      // raw title flows straight through, kebabs to empty, and D2 hashes the
      // RAW title.
      expect(result).toBe(`adr-${fnv1a32Hex(title)}`);
      expect(result).not.toBe("adr");
      expect(slugSchema.safeParse(result).success).toBe(true);
    });

    it("a CJK+emoji mix keeps the transliterated CJK tokens and drops the emoji (non-alnum, stripped by the kebab step)", () => {
      const result = slugify("knowledge", "产品😀定位🎉", { transliterate: transliterateCjk });
      expect(result).toBe("knowledge-chan-pin-ding-wei");
      expect(slugSchema.safeParse(result).success).toBe(true);
    });
  });

  // ─── HAPPY: D3-exact-match -> D2 chain (never independently tested) ──────

  describe("D3 exact type-word match empties the kebab, chaining into D2's hash guard", () => {
    it("a title that IS the type word (case-insensitive) never returns the bare type name", () => {
      const result = slugify("adr", "ADR");
      // D3: kebab("ADR") === "adr" === type -> kebab set to "" -> D2 hashes
      // the RAW title "ADR" (never the bare "adr").
      expect(result).toBe(`adr-${fnv1a32Hex("ADR")}`);
      expect(result).not.toBe("adr");
    });

    it("the already-lowercase type word alone produces the identical D2 chain", () => {
      const result = slugify("adr", "adr");
      expect(result).toBe(`adr-${fnv1a32Hex("adr")}`);
      expect(result).not.toBe("adr");
    });
  });

  // ─── HAPPY: all 7 doc types × prefix-dedup with CJK content ─────────────

  describe("D3 type-prefix dedup holds for every doc type, including CJK-transliterated content", () => {
    const cases: Array<{ type: DocType; expected: string }> = [
      { type: "prd", expected: "prd-ce-shi-biao-ti" },
      { type: "spec", expected: "spec-ce-shi-biao-ti" },
      { type: "adr", expected: "adr-ce-shi-biao-ti" },
      { type: "plan", expected: "plan-ce-shi-biao-ti" },
      { type: "knowledge", expected: "knowledge-ce-shi-biao-ti" },
      { type: "task", expected: "task-ce-shi-biao-ti" },
      { type: "phase", expected: "phase-ce-shi-biao-ti" },
    ];

    for (const { type, expected } of cases) {
      it(`type "${type}": title "${type.toUpperCase()}: 测试标题" does not double-prefix`, () => {
        const title = `${type.toUpperCase()}: 测试标题`;
        const result = slugify(type, title, { transliterate: transliterateCjk });
        expect(result).toBe(expected);
        expect(result.startsWith(`${type}-${type}-`)).toBe(false);
      });
    }
  });

  // ─── STATE (referential transparency): hash-guard determinism ───────────

  describe("D2 hash guard is deterministic and hashes the RAW title, never the transliterated text", () => {
    it("calling slugify twice on the same untransliterable title yields byte-identical slugs", () => {
      const title = "한국어 제목";
      const first = slugify("adr", title, { transliterate: transliterateCjk });
      const second = slugify("adr", title, { transliterate: transliterateCjk });
      expect(first).toBe(second);
    });

    it("a transliterator that MANGLES the text into different punctuation-only output still hashes the ORIGINAL raw title — not the mangled output", () => {
      const title = "产品定位";
      const mangling = () => "!!!@@@###"; // non-alnum-only, kebabs to "" same as a no-op transliterator
      const withMangler = slugify("adr", title, { transliterate: mangling });
      const withNoOpts = slugify("adr", title);
      // Both paths reach D2 with an empty kebab, but via DIFFERENT
      // transliterated intermediate strings ("!!!@@@###" vs the untouched
      // raw title). If D2 accidentally hashed `transliterated` instead of
      // the raw `title`, these two would diverge (different fnv over
      // different input strings). They must be identical.
      expect(withMangler).toBe(withNoOpts);
      expect(withMangler).toBe(`adr-${fnv1a32Hex(title)}`);
    });
  });

  // ─── BOUNDARY: exact 63/64/65-char slug lengths ──────────────────────────

  describe("exact-length boundary: 63 (under), 64 (exactly at the limit), 65 (one over)", () => {
    it("kebab length 58 -> combined 63 chars: no truncation, full content preserved", () => {
      // 28 single-char "a" tokens + one "aa" token, space-separated (29
      // words). Kebab join length = 28*1 + 2 + 28 hyphens = 58.
      const words = [...Array(28).fill("a"), "aa"];
      const title = words.join(" ");
      const result = slugify("task", title);
      expect(result.length).toBe(63);
      expect(result).toBe("task-" + words.join("-"));
    });

    it("kebab length 59 -> combined EXACTLY 64 chars: the <= boundary keeps the FULL kebab, no cut", () => {
      // 30 single-char "a" tokens, space-separated. Kebab join length =
      // 30 + 29 hyphens = 59. combined = 5 ("task-") + 59 = 64.
      const words = Array(30).fill("a");
      const title = words.join(" ");
      const result = slugify("task", title);
      expect(result.length).toBe(64);
      expect(result).toBe("task-" + words.join("-"));
      expect(result.endsWith("-")).toBe(false);
    });

    it("kebab length 60 -> combined 65 chars (one over): D4 drops the incomplete trailing token entirely, never leaving a partial fragment", () => {
      // 29 single-char "a" tokens + one "aa" token, space-separated (30
      // words). Kebab join length = 29*1 + 2 + 29 hyphens = 60.
      // combined = 5 + 60 = 65 -> overflows by 1 -> D4 boundary cut.
      const words = [...Array(29).fill("a"), "aa"];
      const title = words.join(" ");
      const result = slugify("task", title);
      expect(result.length).toBeLessThanOrEqual(64);
      expect(result.length).toBe(62); // drops the whole trailing "aa" token, keeps 29 complete "a" tokens
      expect(result).toBe("task-" + Array(29).fill("a").join("-"));
      // The whole trailing "aa" token is dropped (not cut down to a bare "a"
      // fragment) — confirmed by the exact-string pin above, which would
      // fail if a 30th "-a" segment (the truncated "aa") were still present.
      expect(result.endsWith("-")).toBe(false);
    });
  });

  // ─── NEGATIVE / ERROR: throwing transliterator, nullish titles ──────────

  describe("negative/error: no defensive swallowing around the transliteration hook or the title argument", () => {
    it("a transliterator that throws propagates the error out of slugify (not swallowed into a fallback slug)", () => {
      const boom = () => {
        throw new Error("transliteration blew up");
      };
      expect(() => slugify("adr", "产品定位", { transliterate: boom })).toThrow("transliteration blew up");
    });

    it("a null title (bypassing the TS type system, as an untrusted caller e.g. HTTP/MCP JSON body could) throws rather than silently returning a fallback slug", () => {
      // Documents ACTUAL behavior: `title.trim()` on `null` throws a
      // TypeError. No `?? ""` / try-catch guards this — matches the
      // repo-wide "no silent fallback on required fields" discipline, but
      // is worth pinning explicitly since a well-meaning future edit could
      // introduce a silent `title ?? ""` that would instead return the bare
      // type name.
      expect(() => slugify("adr", null as unknown as string)).toThrow();
    });

    it("an undefined title throws rather than silently returning a fallback slug", () => {
      expect(() => slugify("adr", undefined as unknown as string)).toThrow();
    });
  });

  // ─── REGRESSION: ASCII titles byte-identical WITH and WITHOUT the hook ──

  describe("REGRESSION: pure-ASCII titles are byte-identical whether or not opts.transliterate is supplied", () => {
    const pairs: Array<{ type: DocType; title: string }> = [
      { type: "spec", title: "Add dark mode toggle to settings page" },
      { type: "knowledge", title: "API Rate Limiting Best Practices" },
      { type: "task", title: "Fix flaky CI test in the sync-docs suite" },
      { type: "plan", title: "Q3 roadmap: migrate to Turso sync" },
    ];

    for (const { type, title } of pairs) {
      it(`"${title}" (type ${type})`, () => {
        const withoutHook = slugify(type, title);
        const withHook = slugify(type, title, { transliterate: transliterateCjk });
        expect(withHook).toBe(withoutHook);
      });
    }

    it("distinct ASCII titles still produce DISTINCT slugs (defeats a hardcoded-return stub)", () => {
      const a = slugify("spec", "Add dark mode toggle to settings page");
      const b = slugify("knowledge", "API Rate Limiting Best Practices");
      expect(a).not.toBe(b);
    });
  });
});
