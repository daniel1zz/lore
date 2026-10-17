// @reads packages/core/src/**
/**
 * AC-062-8 REGRESSION oracle — `@lore/core`'s default barrel (`src/index.ts`)
 * must never transitively import a Node builtin, or `@lore/dashboard`'s Vite
 * dev-mode `fs` stub blanks the SPA at module-LOAD time (see `src/index.ts`'s
 * own header, and `src/CLAUDE.md`'s "Browser safety" invariant).
 *
 * Before this file, the ONLY mechanized guard for this invariant was a
 * Playwright e2e suite (`packages/dashboard/tests/e2e/write-flow.pw.ts`) that
 * exercises the SPA at runtime — a real oracle, but slow and indirect (a
 * `pageerror` tells you the SPA broke, not which file caused it). This is a
 * fast, deterministic, static-source-scan oracle: it walks `index.ts`'s
 * TRANSITIVE relative-import closure (every local `./`/`../` import, followed
 * recursively) and asserts zero files in that closure statically import a
 * Node builtin (`node:*`, or a bare `fs`/`path`/`os`/`child_process` specifier
 * — the exact set named in `src/index.ts`'s own module header).
 *
 * This does NOT replace the Playwright e2e suite (a static scan can miss a
 * dynamic `import()` or a re-export through a third-party package that itself
 * imports Node builtins) — it catches the common case (a new source file
 * added to the barrel's closure with a stray top-level `import ... from
 * "fs"`) at vitest speed, long before a Playwright run would.
 *
 * Source: SPEC-062 §Acceptance Criteria AC-062-8.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(HERE, "..", "src");
const BARREL_ENTRY = join(CORE_SRC, "index.ts");

/** Matches any `import`/`export ... from "<specifier>"` clause, capturing the specifier. */
const FROM_CLAUSE_RE = /(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;

/**
 * Strips `/* ... *\/` block comments and `// ...` line comments before the
 * from-clause scan runs — WITHOUT this, this codebase's own extensive JSDoc
 * module headers (which routinely quote `from "fs"` in prose, e.g.
 * `index.ts`'s own browser-safety invariant doc) produce false-positive
 * "import" matches against comment TEXT rather than real code. A false
 * positive here is the more dangerous failure mode (it would make this
 * REGRESSION oracle permanently red and get "fixed" by loosening it), so
 * comments are stripped first rather than trying to make the from-clause
 * regex comment-aware.
 */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * The exact Node-builtin specifier set named in `index.ts`'s own module
 * header ("fs", "path", "os", "child_process", "node:*") — NOT every Node
 * builtin that exists (e.g. this deliberately does not flag "assert" or
 * "util", which are not called out anywhere in this codebase's browser-safety
 * invariant and would risk false-positive drift from this oracle's own
 * scope).
 */
const NODE_BUILTIN_SPECIFIER_RE = /^(node:.+|fs|path|os|child_process)$/;

/**
 * Resolves a relative import specifier (`./foo.js` / `../bar.js`) from
 * `fromFile` to an absolute `.ts` source path, or `null` when the specifier
 * is not relative (a bare package specifier like `"zod"` or `"yaml"`) or the
 * resolved file does not exist on disk.
 */
function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const withoutExtension = specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier;
  const candidate = `${resolve(dirname(fromFile), withoutExtension)}.ts`;
  return existsSync(candidate) ? candidate : null;
}

/**
 * Walks `entry`'s transitive relative-import closure (BFS over `./`/`../`
 * imports only — bare package specifiers are not followed, since a Node
 * builtin can only ever be reached from THIS module graph via a literal
 * `"fs"`/`"path"`/`"os"`/`"child_process"`/`"node:*"` specifier, never through
 * an intermediate npm package).
 *
 * @returns The set of absolute file paths in the closure, INCLUDING `entry` itself.
 */
function collectRelativeImportClosure(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);

    const content = stripComments(readFileSync(file, "utf8"));
    for (const match of content.matchAll(FROM_CLAUSE_RE)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = resolveRelativeModule(file, specifier);
      if (resolved !== null && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

/** Every specifier a file statically imports/re-exports from (via a `from "..."` clause). */
function collectImportSpecifiers(file: string): string[] {
  const content = stripComments(readFileSync(file, "utf8"));
  return [...content.matchAll(FROM_CLAUSE_RE)].map((m) => m[1]).filter((s): s is string => s !== undefined);
}

describe("AC-062-8 REGRESSION — @lore/core default barrel stays browser-safe", () => {
  it("index.ts's transitive relative-import closure imports zero Node builtins", () => {
    const closure = collectRelativeImportClosure(BARREL_ENTRY);

    // Sanity check: the closure must have actually walked something non-trivial —
    // a regex/resolution bug that silently visits only `index.ts` itself would
    // otherwise make this test vacuously (and falsely) green.
    expect(closure.size).toBeGreaterThan(10);

    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const file of closure) {
      for (const specifier of collectImportSpecifiers(file)) {
        if (NODE_BUILTIN_SPECIFIER_RE.test(specifier)) {
          offenders.push({ file, specifier });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("config-editability.ts (SPEC-062) is reachable from the barrel and contributes zero Node-builtin imports", () => {
    const closure = collectRelativeImportClosure(BARREL_ENTRY);
    const target = join(CORE_SRC, "config-editability.ts");

    expect(closure.has(target)).toBe(true);

    const offenders = collectImportSpecifiers(target).filter((s) => NODE_BUILTIN_SPECIFIER_RE.test(s));
    expect(offenders).toEqual([]);
  });

  it("NEGATIVE (self-check): the Node-builtin detector actually fires on a known Node-only file", () => {
    // config-node.ts is the documented Node-only sibling (fs/path/os) that is
    // deliberately NOT reachable from index.ts's closure — this proves the
    // regex/logic above is capable of a true positive, not merely never firing.
    const configNodeFile = join(CORE_SRC, "config-node.ts");
    const offenders = collectImportSpecifiers(configNodeFile).filter((s) =>
      NODE_BUILTIN_SPECIFIER_RE.test(s),
    );
    expect(offenders.length).toBeGreaterThan(0);

    const closure = collectRelativeImportClosure(BARREL_ENTRY);
    expect(closure.has(configNodeFile)).toBe(false);
  });
});
