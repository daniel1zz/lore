// @reads packages/core/src/**
/**
 * AC-068-6 — static import-graph oracle: `pinyin-pro` (SPEC-068 D1, ~931KB
 * unpacked) MUST be unreachable from the `@lore/core` default barrel
 * (`packages/core/src/index.ts`)'s transitive closure. Mirrors this package's
 * own pre-existing browser-safety invariant (packages/core/src/CLAUDE.md,
 * "Browser safety") for `fs`/`path`/`os` in `config-node.ts`/`telemetry-node.ts` —
 * a `pinyin-pro` import reaching the barrel would blank the dashboard SPA in dev
 * mode the same way an `fs` import did before that split existed.
 *
 * Method: parse `index.ts`'s own import/export specifiers, follow every
 * RELATIVE (`./`/`../`) one recursively (`.js` specifiers map 1:1 to `.ts`
 * source files — this package's intra-package import convention), collect the
 * full transitive closure of source files, and assert:
 *   1. No BARE (non-relative) import specifier anywhere in that closure is
 *      "pinyin-pro" (would only ever appear in `slugify-node.ts`).
 *   2. The closure never includes `node.ts` or `slugify-node.ts` themselves —
 *      the stronger, structural version of the same invariant (barrel-safe
 *      modules can't reach the /node-only subpath at all, not merely "don't
 *      import pinyin-pro directly").
 *
 * A SECOND, independent invariant lives in `slugify-node.ts` itself (not the
 * barrel): `pinyin-pro` must load LAZILY (on first CJK title) rather than at
 * module top level, even within its own sanctioned `/node`-subpath file —
 * root-caused via migrate-phases integration-test timing (30s->46s under
 * repeated CLI spawns; measured `~1s` per source-mode `import("pinyin-pro")`,
 * paid by EVERY `lore` process on the CLI's import chain regardless of
 * whether the corpus ever has a CJK title). Pinned below as an additional
 * AC-068-6 case: `slugify-node.ts` may contain a top-level `import type`
 * (erased, zero runtime cost) but NO top-level static VALUE import of
 * `pinyin-pro` — the real load happens via a STATIC-SPECIFIER dynamic
 * `import("pinyin-pro")` nested inside `getTransliterateCjk()`'s body, never
 * a bare `require()` (SPEC-068 hotfix, 2026-07-23: the original
 * `createRequire(import.meta.url)("pinyin-pro")` form could not resolve the
 * package from inside a `bun build --compile`d binary's virtual `$bunfs/root`
 * filesystem — a literal-specifier dynamic `import()` IS bundled by `bun
 * build --compile` and loads correctly there; see slugify-node.ts's own
 * header and `packages/lore/tests/integration/cli/slugify-compiled.bun.test.ts`,
 * AC-068-10, for the compiled-binary regression oracle).
 *
 * Runner: vitest (pure fs/path read, no `bun:sqlite`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/lore/tests/unit/core -> packages/core/src (4 levels up + core/src)
const CORE_SRC = resolve(__dirname, "../../../../core/src");
const ENTRY = join(CORE_SRC, "index.ts");

/** Matches `from "specifier"` / `from 'specifier'` in `import`/`export * from` statements. */
const IMPORT_SPECIFIER_PATTERN = /\bfrom\s+["']([^"']+)["']/g;

/**
 * Recursively collects the transitive closure of RELATIVE-import source files
 * reachable from `entryFile`, plus the set of every BARE (non-relative) import
 * specifier encountered anywhere in that closure.
 */
function collectImportClosure(entryFile: string): {
  visitedFiles: Set<string>;
  bareSpecifiers: Set<string>;
} {
  const visitedFiles = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const stack = [entryFile];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visitedFiles.has(file)) continue;
    if (!existsSync(file)) {
      // A relative specifier that doesn't resolve to a source file on disk is
      // a scan bug, not a pass — fail loud rather than silently skip it.
      throw new Error(`barrel-isolation scan: cannot resolve import target "${file}"`);
    }
    visitedFiles.add(file);

    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1]!;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        // Intra-package convention: relative specifiers always end in ".js"
        // and map 1:1 to a ".ts" source file in this directory tree.
        const resolved = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
        stack.push(resolved);
      } else {
        bareSpecifiers.add(specifier);
      }
    }
  }

  return { visitedFiles, bareSpecifiers };
}

describe("AC-068-6: @lore/core default barrel is unreachable from pinyin-pro", () => {
  it("index.ts's transitive closure contains zero pinyin-pro imports", () => {
    const { bareSpecifiers } = collectImportClosure(ENTRY);
    expect(bareSpecifiers.has("pinyin-pro")).toBe(false);
  });

  it("index.ts's transitive closure never reaches node.ts or slugify-node.ts", () => {
    const { visitedFiles } = collectImportClosure(ENTRY);
    const relativePaths = [...visitedFiles].map((f) => f.replace(CORE_SRC + "/", ""));
    expect(relativePaths).not.toContain("node.ts");
    expect(relativePaths).not.toContain("slugify-node.ts");
  });

  it("sanity check: the scanner itself actually walks a non-trivial closure (not a false-pass on an empty graph)", () => {
    const { visitedFiles } = collectImportClosure(ENTRY);
    // index.ts re-exports schemas.ts, types.ts, errors.ts, etc. — dozens of files.
    expect(visitedFiles.size).toBeGreaterThan(10);
  });

  it("control: node.ts's OWN closure DOES reach pinyin-pro (proves the scanner can detect a real hit)", () => {
    const { bareSpecifiers } = collectImportClosure(join(CORE_SRC, "node.ts"));
    // The hit comes from slugify-node.ts's top-level `import type` line below —
    // the scanner's `from "..."` pattern matches both value and type-only
    // imports (it's a specifier-presence scan, not an eager-vs-lazy check;
    // that distinction is the dedicated test right below).
    expect(bareSpecifiers.has("pinyin-pro")).toBe(true);
  });

  it("AC-068-6 (startup-tax fix, hotfix 2026-07-23): slugify-node.ts has NO top-level static VALUE import of pinyin-pro — type-only + lazy STATIC-SPECIFIER dynamic import", () => {
    const content = readFileSync(join(CORE_SRC, "slugify-node.ts"), "utf8");

    // No eager VALUE import (`import { pinyin } from "pinyin-pro"`, default,
    // or namespace form) — a top-level line is only allowed to reference the
    // bare specifier via `import type`.
    const eagerValueImportPattern = /^\s*import\s+(?!type\b)[^;]*from\s+["']pinyin-pro["']/m;
    expect(eagerValueImportPattern.test(content)).toBe(false);

    // A type-only import of pinyin-pro IS present — erased at compile time
    // (zero runtime cost), proving the dependency is deliberately deferred,
    // not silently dropped.
    const typeOnlyImportPattern = /^\s*import\s+type\s+[^;]*from\s+["']pinyin-pro["']/m;
    expect(typeOnlyImportPattern.test(content)).toBe(true);

    // No CJS require() of pinyin-pro anywhere — the hotfix retired
    // createRequire(import.meta.url)("pinyin-pro") entirely (it could not
    // resolve the package from inside a `bun build --compile`d binary's
    // virtual filesystem).
    expect(content).not.toMatch(/require\(["']pinyin-pro["']\)/);

    // The lazy dynamic import() call exists, indented (nested inside a
    // function body — never at column 0 / module top level, where it would
    // execute eagerly on every module load regardless of whether a CJK title
    // is ever seen), AND its specifier is a STATIC string literal — never a
    // template literal or variable. A computed specifier would defeat bun's
    // compile-time bundling of the dynamic import (the exact mechanism this
    // hotfix relies on to survive `bun build --compile`).
    expect(content).toMatch(/\n[ \t]+.*import\(["']pinyin-pro["']\)/);
    expect(content).not.toMatch(/^import\(["']pinyin-pro["']\)/m);
    expect(content).not.toMatch(/import\(\s*[`$]/); // no template-literal/variable specifier
  });
});
