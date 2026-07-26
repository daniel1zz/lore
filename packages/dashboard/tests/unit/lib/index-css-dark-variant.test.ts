/**
 * CSS-level regression test for ISSUE-009 (light-theme markdown prose
 * near-invisible, ~1.4:1 contrast).
 *
 * Root cause (verified against a real Tailwind v4 build —
 * `bunx vite build` + grepping the emitted CSS for `prefers-color-scheme`,
 * see task completion report): Tailwind v4's `dark:` variant defaults to the
 * `prefers-color-scheme` MEDIA QUERY, not the `.dark` CLASS `useTheme()`
 * (`src/lib/theme.ts`) toggles on `documentElement`. Every `dark:*` utility in
 * this app (`dark:prose-invert`, `dark:border-l-*`, ...) therefore tracked the
 * OS-level preference instead of the in-app theme choice — on an OS set to
 * dark, `dark:prose-invert` fired even while the app rendered its light theme,
 * painting the dark-mode-inverted (near-white) prose foreground onto a white
 * body.
 *
 * This is a pure text-level assertion (no jsdom/build step needed) rather
 * than a rendered-DOM test: jsdom has no CSS engine, so it cannot compute
 * `getComputedStyle(...).color` for a Tailwind utility class the way a real
 * browser can — the ONLY way to pin this fix at the unit-test layer is to
 * assert the source directive that controls it. End-to-end visual contrast
 * was separately verified against a real `vite build` + `vite preview`
 * (light mode: `--tw-prose-body` resolved to `oklch(0.373 ...)`, a dark
 * foreground, vs. the pre-fix `oklch(0.872 ...)`; see task completion report).
 *
 * Test plan:
 *   HAPPY — `src/index.css` declares the class-based dark-variant override
 *     (`@custom-variant dark (&:where(.dark, .dark *));`), imported before any
 *     `dark:*` utility could be compiled against it.
 *   REGRESSION — the override is not shadowed by a second, later
 *     `@custom-variant dark` declaration that reintroduces
 *     `prefers-color-scheme` (which would silently nullify the fix — the
 *     LAST `@custom-variant dark` declaration in a stylesheet wins).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// reason: Vite statically detects the `new URL(relative, import.meta.url)`
// pattern and rewrites it into a build-time ASSET url (resolves to something
// like `http://localhost:3000/src/index.css` under Vitest's Vite transform,
// not a `file://` path) — a plain `fileURLToPath(import.meta.url)` call (no
// second URL argument) is NOT special-cased, so the relative traversal is
// done afterward with plain `node:path`, invisible to that rewrite.
const THIS_FILE = fileURLToPath(import.meta.url);
const INDEX_CSS_PATH = resolve(dirname(THIS_FILE), "../../../src/index.css");

describe("src/index.css dark-variant override (ISSUE-009)", () => {
  describe("happy path", () => {
    it("declares the class-based @custom-variant dark override", () => {
      const css = readFileSync(INDEX_CSS_PATH, "utf-8");
      expect(css).toMatch(/@custom-variant\s+dark\s*\(&:where\(\.dark,\s*\.dark \*\)\);/);
    });

    it("declares the override before the @theme/:root token blocks (so dark: utilities resolve against it from the first compiled rule)", () => {
      const css = readFileSync(INDEX_CSS_PATH, "utf-8");
      const variantIndex = css.indexOf("@custom-variant dark");
      const themeIndex = css.indexOf("@theme inline");
      expect(variantIndex).toBeGreaterThan(-1);
      expect(themeIndex).toBeGreaterThan(-1);
      expect(variantIndex).toBeLessThan(themeIndex);
    });
  });

  describe("regression: not shadowed by a later conflicting declaration", () => {
    it("contains exactly one @custom-variant dark declaration", () => {
      const css = readFileSync(INDEX_CSS_PATH, "utf-8");
      const matches = css.match(/@custom-variant\s+dark\b/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it("the declaration never falls back to prefers-color-scheme", () => {
      const css = readFileSync(INDEX_CSS_PATH, "utf-8");
      const line = css.split("\n").find((l) => l.includes("@custom-variant dark"));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/prefers-color-scheme/);
    });
  });
});
