/**
 * Recursive directory walker — shared by MigrationService (v1 markdown import),
 * ExportDocsService (type-directory scan), and the `migration-coverage` eval scenario
 * (recursive `.md` count).
 *
 * Public surface:
 *   - walkFiles(dir, opts?) — list files under `dir`, optionally recursive and
 *     extension-filtered.
 *   - WalkFilesOptions
 *
 * Invariants:
 *   - Dirent-based (`readdirSync(dir, {withFileTypes: true})`) — recursion and the
 *     file/directory split both come from the dirent, not a separate `statSync` call.
 *     This does NOT follow symlinks when deciding directory-vs-file (matches
 *     migration-service's pre-extraction `walkDir`, the strictest of the three original
 *     call sites); a symlinked directory is treated as whatever the dirent reports.
 *   - Only entries where `dirent.isFile()` is true are ever returned — this is stricter
 *     than export-docs-service's original flat scan (which matched by NAME only, with no
 *     file/directory check, and let a false-positive directory match fail later at
 *     `readFileSync`). The narrowed check never changes the OBSERVABLE result at that
 *     call site: an entry that would have failed `readFileSync` there is simply excluded
 *     one step earlier here, and the caller's downstream Map never gains an entry either
 *     way.
 *   - `onError` governs a `readdirSync` failure on `dir` (or a recursed subdirectory):
 *       "throw" (default) — propagates immediately, matching migration-service's
 *                            `collectMdFiles`, which wraps the whole walk in ONE try/catch
 *                            and converts any throw to a `STORE_ERROR` Result.
 *       "skip"            — treats the unreadable directory as empty and continues,
 *                            matching the eval scenario's original per-subtree swallow
 *                            (`eval/scenarios/migration-coverage.ts`'s `countMarkdownFiles`
 *                            had its own try/catch INSIDE every recursive call, so one
 *                            unreadable subdirectory only zeroed that subtree, never the
 *                            whole count — SPEC-013 §3 "eval must never throw").
 *   - No dependency beyond `node:fs`/`node:path` — dependency-free by design (refactor
 *     task constraint: don't introduce a filesystem-walking library for three call sites).
 *
 * Side-effect class: IO (readdirSync).
 *
 * Source: refactor — shared recursive dir-walk helper (migration-service.ts,
 *   export-docs-service.ts, eval/scenarios/migration-coverage.ts each hand-rolled one).
 */

import { readdirSync, type Dirent } from "fs";
import { join, extname } from "path";

/** Options for {@link walkFiles}. All fields optional — see module header for semantics. */
export interface WalkFilesOptions {
  /**
   * File extensions to include, matched via `node:path`'s `extname()` (e.g. `[".md"]`).
   * Omitted or empty ⇒ no extension filter (every file entry is included).
   */
  extensions?: string[];
  /** Recurse into subdirectories. Default `true`. */
  recursive?: boolean;
  /**
   * How to handle a `readdirSync` failure on a directory — see module header.
   * Default `"throw"`.
   */
  onError?: "throw" | "skip";
}

/**
 * List files under `dir`, optionally recursing into subdirectories and filtering by
 * extension.
 *
 * @param dir - Directory to walk.
 * @param opts - See {@link WalkFilesOptions}. All fields optional.
 * @returns Absolute (or `dir`-relative, matching `dir`'s own form) file paths, in
 *   `readdirSync` traversal order (depth-first, subdirectory contents inserted where the
 *   subdirectory itself was encountered).
 * @throws Propagates a `readdirSync` error on `dir` or a recursed subdirectory when
 *   `opts.onError` is `"throw"` (the default).
 * @example
 *   walkFiles("/repo/docs", { extensions: [".md"] })
 *   // => ["/repo/docs/a.md", "/repo/docs/sub/b.md"]
 */
export function walkFiles(dir: string, opts: WalkFilesOptions = {}): string[] {
  const { extensions, recursive = true, onError = "throw" } = opts;
  const matchesExtension = (name: string): boolean =>
    !extensions || extensions.length === 0 || extensions.includes(extname(name));

  const acc: string[] = [];
  walk(dir);
  return acc;

  function walk(currentDir: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      if (onError === "skip") return;
      throw e;
    }
    for (const entry of entries) {
      const full = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(full);
      } else if (entry.isFile() && matchesExtension(entry.name)) {
        acc.push(full);
      }
    }
  }
}
