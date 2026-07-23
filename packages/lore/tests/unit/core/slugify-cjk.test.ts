/**
 * Unit tests for SPEC-068's CJK-aware `slugify` (D1-D4) — AC-068-1, AC-068-2,
 * AC-068-3, AC-068-4, AC-068-5, AC-068-9.
 *
 * All golden expected values in this file are derived from an INDEPENDENT
 * re-derivation of the D1-D4 rules (a scratch oracle script, discarded after
 * use — never imported from `schemas.ts`/`slug-hash.ts`), or from
 * `pinyin-pro`'s own documented API behavior — never by running the
 * implementation under test and copying its output. See SPEC-068
 * `spec-cjk-aware-slugify-pinyin-transliteration-lore-set-slug-repa`.
 *
 * Runner: vitest (no `bun:sqlite` — plain `@lore/core`/`@lore/core/node` imports).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { slugify, slugSchema } from "@lore/core";
import { getTransliterateCjk } from "@lore/core/node";

describe("slugify — SPEC-068 CJK transliteration + repair (D1-D4)", () => {
  // `getTransliterateCjk()` is async (SPEC-068 hotfix 2026-07-23 — dynamic
  // `import("pinyin-pro")`, compile-safe under `bun build --compile`); resolve
  // the cached sync transliterator once, then pass it into `slugify`'s sync
  // `opts.transliterate` hook the same way every production caller does.
  let transliterateCjk: (text: string) => string;
  beforeAll(async () => {
    transliterateCjk = await getTransliterateCjk();
  });

  it("AC-068-1: all-CJK title transliterates to a tone-less pinyin slug", () => {
    const title = "产品定位：内部圈子使用，功能强大优先于合规保守";
    const result = slugify("adr", title, { transliterate: transliterateCjk });

    expect(result.startsWith("adr-chan-pin-ding-wei")).toBe(true);
    expect(slugSchema.safeParse(result).success).toBe(true);
    // Pin the full computed value too (independent oracle, see module header).
    expect(result).toBe("adr-chan-pin-ding-wei-nei-bu-quan-zi-shi-yong-gong-neng-qiang");
  });

  it("AC-068-2: mixed CJK/ASCII title preserves ASCII tokens verbatim, in original order", () => {
    const title = "ADR: internal-circle 定位测试 mixed";
    const result = slugify("adr", title, { transliterate: transliterateCjk });

    expect(result).toBe("adr-internal-circle-ding-wei-ce-shi-mixed");
    // Explicit order assertion independent of the exact-string pin above:
    // "internal-circle" (ASCII span) appears before "mixed" (ASCII span),
    // matching the raw title's left-to-right order.
    expect(result.indexOf("internal-circle")).toBeGreaterThan(-1);
    expect(result.indexOf("mixed")).toBeGreaterThan(result.indexOf("internal-circle"));
    expect(slugSchema.safeParse(result).success).toBe(true);
  });

  it("AC-068-3: title beginning with the type word never duplicates the prefix", () => {
    const result = slugify("adr", "ADR: internal-circle positioning");
    expect(result).toBe("adr-internal-circle-positioning");
    // Pre-SPEC-068 behavior would have produced "adr-adr-internal-circle-positioning"
    // (D3 is the documented divergence — see AC-068-9's golden table below).
    expect(result).not.toContain("adr-adr-");
  });

  it("AC-068-4: truncation at 64 chars ends on a complete hyphen-separated token", () => {
    const title =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango";
    const result = slugify("task", title);

    expect(result.length).toBeLessThanOrEqual(64);
    expect(result.endsWith("-")).toBe(false);
    // Independent oracle golden (D4 boundary cut — stops before the truncated
    // "jul" fragment of "juliet", keeps only complete tokens).
    expect(result).toBe("task-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india");
    // No partial word: every token in the result is a complete token from the
    // original title (never a truncated fragment like "jul").
    const tokens = result.replace(/^task-/, "").split("-");
    const sourceTokens = title.toLowerCase().split(" ");
    for (const token of tokens) {
      expect(sourceTokens).toContain(token);
    }
  });

  it("AC-068-4: first name token alone overflowing the limit keeps the hard character cut", () => {
    const title = "x".repeat(80) + " short second token";
    const result = slugify("task", title);

    expect(result.length).toBe(64);
    // Independent oracle golden: no hyphen boundary reachable within 64 chars
    // after "task-", so the hard cut mid-first-token is kept (D4 exception).
    expect(result).toBe("task-" + "x".repeat(59));
  });

  it("AC-068-5: Korean title (transliterator injected but doesn't cover Hangul) yields a deterministic hash slug", () => {
    const title = "한국어 제목";
    const result = slugify("adr", title, { transliterate: transliterateCjk });

    expect(result).not.toBe("adr");
    expect(result).toBe("adr-9a3f4081");
    expect(slugSchema.safeParse(result).success).toBe(true);
    // Deterministic: calling again yields the identical hash.
    expect(slugify("adr", title, { transliterate: transliterateCjk })).toBe(result);
  });

  it("AC-068-5: CJK title with NO transliterator injected yields the same deterministic hash guard", () => {
    const title = "产品定位";
    const result = slugify("adr", title);

    expect(result).not.toBe("adr");
    expect(result).toBe("adr-8d02d998");
    expect(slugSchema.safeParse(result).success).toBe(true);
  });

  it("AC-068-5: emoji-only title never returns the bare type name", () => {
    const result = slugify("knowledge", "😀🎉");
    expect(result).not.toBe("knowledge");
    expect(result.startsWith("knowledge-")).toBe(true);
    expect(slugSchema.safeParse(result).success).toBe(true);
  });

  it("AC-068-5 exemption: an empty/whitespace-only title keeps the bare-prefix behavior", () => {
    expect(slugify("adr", "")).toBe("adr");
    expect(slugify("adr", "   ")).toBe("adr");
  });

  describe("AC-068-9: golden regression table — ASCII titles stay byte-identical except documented D3/D4 cases", () => {
    it("unaffected ASCII title #1 — byte-identical to pre-SPEC-068 output", () => {
      expect(slugify("spec", "Add dark mode toggle to settings page")).toBe(
        "spec-add-dark-mode-toggle-to-settings-page",
      );
    });

    it("unaffected ASCII title #2 — byte-identical to pre-SPEC-068 output", () => {
      expect(slugify("knowledge", "API Rate Limiting Best Practices")).toBe(
        "knowledge-api-rate-limiting-best-practices",
      );
    });

    it("documented D3 divergence — type-word-prefixed title no longer duplicates the prefix", () => {
      const result = slugify("adr", "ADR: internal-circle positioning");
      // Pre-SPEC-068 this produced "adr-adr-internal-circle-positioning" (the
      // SPEC-068 Problem §2 defect this task fixes).
      expect(result).toBe("adr-internal-circle-positioning");
    });

    it("documented D4 divergence — overflow no longer mid-word-truncates", () => {
      const title =
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango";
      const result = slugify("task", title);
      // Pre-SPEC-068 this hard-sliced to 64 chars and produced a mid-word
      // fragment: "task-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-jul"
      // (a truncated "juliet" — the SPEC-068 Problem §3 defect this task fixes).
      expect(result).toBe("task-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india");
      expect(result.endsWith("-jul")).toBe(false);
    });
  });
});
