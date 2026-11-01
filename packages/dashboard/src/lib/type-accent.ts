/**
 * Type accent map — one Tailwind left-border color hue per {@link DocType}
 * (SPEC-036 §1 D3). Single source of truth for type-differentiated visual
 * accent — consumed by both `DocCard`'s left border and `DocDetail`'s header
 * accent, so a given type always renders the identical hue on both surfaces.
 *
 * Public surface: TYPE_ACCENT, TYPE_ACCENT_BORDER_CLASS
 * Invariants:
 *   - Accent color is non-text decoration only — every surface that applies
 *     TYPE_ACCENT ALSO renders the type name as a text badge elsewhere, so a
 *     colorblind user never depends on hue alone (SPEC-036 §4 A11y).
 *   - Each hue clears WCAG 1.4.11 non-text contrast (>=3:1) against the
 *     shadcn `--card` background in BOTH themes. Verified by computing sRGB
 *     from the exact `oklch()` triples in the installed `tailwindcss` v4
 *     `theme.css` (OKLab->linear-sRGB matrix + WCAG relative-luminance
 *     formula) against the project's actual `--card` tokens
 *     (`src/index.css`: light `hsl(0 0% 100%)` = #ffffff, dark
 *     `hsl(222.2 84% 4.9%)` = #02081c). The naive "500 light / 400 dark"
 *     pairing suggested by common Tailwind accent examples FAILS this check
 *     for most hues in light mode (e.g. sky-500 vs #ffffff ~= 2.71:1); the
 *     600/500 pairing below was chosen because it clears >=3.2:1 (light,
 *     shade 600 vs #ffffff) and >=4.3:1 (dark, shade 500 vs #02081c) for
 *     every hue used here.
 * Side-effect class: pure
 * Source: SPEC-036 §1 D3, AC-36-9
 */

import type { DocType } from "@lore/core";

/** Shared border width/side utility — compose with `TYPE_ACCENT[doc.type]`. */
export const TYPE_ACCENT_BORDER_CLASS = "border-l-4";

/**
 * One Tailwind `border-l-<hue>-600 dark:border-l-<hue>-500` class string per
 * doc type. `prd` gets an accent too (unlike {@link DocTypeMeta}, which has no
 * `prd` variant) — the accent border is purely visual, independent of whether
 * a type carries structured meta.
 */
export const TYPE_ACCENT: Record<DocType, string> = {
  prd: "border-l-violet-600 dark:border-l-violet-500",
  spec: "border-l-sky-600 dark:border-l-sky-500",
  adr: "border-l-amber-600 dark:border-l-amber-500",
  plan: "border-l-emerald-600 dark:border-l-emerald-500",
  knowledge: "border-l-fuchsia-600 dark:border-l-fuchsia-500",
  task: "border-l-orange-600 dark:border-l-orange-500",
  // SPEC-056 T4 — "phase" registered as a real DocType (compile-forced entry —
  // TYPE_ACCENT is a fully-typed Record<DocType, string>). Distinct hue from
  // every other entry above (WCAG pairing convention unverified for this new
  // hue; dashboard phase-doc rendering is a later task's scope).
  phase: "border-l-teal-600 dark:border-l-teal-500",
  // baseline (spec-baseline-slice-1 C1) — compile-forced entry; distinct hue.
  baseline: "border-l-indigo-600 dark:border-l-indigo-500",
  // template (structured documents T2) — compile-forced entry; distinct hue.
  template: "border-l-rose-600 dark:border-l-rose-500",
};
