/**
 * Minimal filesystem port contracts (SPEC-context-verb-family D9) — the
 * narrow, injectable seam `service/context-facts.ts` and
 * `flows/context-flow.ts` read/write through instead of importing Node's
 * `fs` directly. Keeping the surface to three read methods + one write
 * method lets ~80% of the context-verb logic run as pure-vitest unit tests
 * against {@link InMemoryFsPort}, with the real `fs`-backed implementation
 * (Node-only, lives in `packages/lore/src/**`, never in `@lore/core`) wired
 * only at the CLI adapter boundary.
 *
 * Public surface:
 *   - FsReadPort — read-only capability: exists / readFile / listDir.
 *   - FsWritePort — FsReadPort + writeFile + optional deleteFile (D15 prune).
 *   - InMemoryFsPort — Map-backed FsWritePort test double.
 *
 * Invariants:
 *   - No Node builtins here — these are interfaces plus a plain-object test
 *     double; the real fs-backed adapter is a separate, Node-only file so
 *     this leaf stays part of the browser-safe `@lore/core` barrel.
 *   - All methods are Promise-returning even though {@link InMemoryFsPort}
 *     resolves synchronously — real implementations do real IO.
 *
 * Source: `spec-context-verb-family-two-zone-claude-md-anatomy-lore` §Public
 *   Interface, §Design Decisions D9.
 */

import { err, ok, type LoreError, type Result } from "./errors.js";

/**
 * Read-only filesystem capability. Paths are caller-defined strings (the
 * context-verb callers use repo-relative POSIX paths); this contract does
 * not itself normalize or validate them.
 */
export interface FsReadPort {
  /** Resolves `true` iff a file or directory exists at `path`. Never throws for a missing path. */
  exists(path: string): Promise<boolean>;
  /** Resolves the file's UTF-8 content, or `null` if `path` does not exist (mirrors read-or-absent, not read-or-throw). */
  readFile(path: string): Promise<string | null>;
  /** Resolves the entry names directly inside directory `path` (not recursive). Resolves `[]` if `path` has no entries (including when it does not exist). */
  listDir(path: string): Promise<string[]>;
}

/** Read + write filesystem capability — {@link FsReadPort} plus a write method and an optional delete. */
export interface FsWritePort extends FsReadPort {
  /**
   * Writes `content` to `path`, creating or overwriting it wholesale (no partial/append writes).
   * ROOTED (BR-1177): a port is constructed with the roots it may write under; a `path` outside every
   * root resolves `err(VALIDATION_ERROR)` and nothing is written. A genuine disk failure still throws.
   */
  writeFile(path: string, content: string): Promise<Result<void, LoreError>>;
  /**
   * Removes the file at `path`; a no-op when it does not exist; outside every root = `err(VALIDATION_ERROR)`, target untouched. Optional so read/write-only test
   * doubles stay valid; a caller that NEEDS to delete (spec-context-fragments D15 prune) must
   * refuse loudly when the port lacks it, never skip silently.
   */
  deleteFile?(path: string): Promise<Result<void, LoreError>>;
  /**
   * Removes the directory at `path` ONLY when it exists and holds no entries; a no-op when it is absent
   * or non-empty (never recursive, never throws for those two cases). Optional: a port without real
   * directories (the in-memory double) may omit it, and a caller treats the cleanup as best-effort.
   */
  removeDirIfEmpty?(path: string): Promise<Result<void, LoreError>>;
}

/**
 * Map-backed {@link FsWritePort} test double — an in-memory flat file table,
 * no real directory structure. `listDir` is derived from key prefixes: an
 * entry `"a/b/c.txt"` is a direct child of directory `"a/b"` and shows up as
 * `"c.txt"`; it is NOT a listing of `"a"` (no recursive/transitive matches).
 *
 * @example
 * const fs = new InMemoryFsPort({ "CLAUDE.md": "# hello" });
 * await fs.exists("CLAUDE.md"); // true
 * await fs.readFile("missing.md"); // null
 * await fs.writeFile("docs/a.md", "x");
 * await fs.listDir("docs"); // ["a.md"]
 */
export class InMemoryFsPort implements FsWritePort {
  private readonly files: Map<string, string>;
  private readonly roots: readonly string[] | undefined;

  /**
   * @param initialFiles - Optional seed content, keyed by path (as passed to {@link readFile}).
   * @param roots - Writable roots (lexical containment; this double has no symlinks to model). `""`/`"."`
   *   is the relative-path space. Omitted = UNROOTED, a test-only convenience for suites that exercise
   *   flow logic rather than the root guard; every production port is constructed with roots.
   */
  constructor(initialFiles?: Record<string, string>, roots?: readonly string[]) {
    this.files = new Map(Object.entries(initialFiles ?? {}));
    this.roots = roots;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async listDir(path: string): Promise<string[]> {
    const prefix = path === "" ? "" : `${stripTrailingSlash(path)}/`;
    const children = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const rest = key.slice(prefix.length);
      const firstSegment = rest.split("/")[0];
      if (firstSegment) {
        children.add(firstSegment);
      }
    }
    return [...children];
  }

  async writeFile(path: string, content: string): Promise<Result<void, LoreError>> {
    const guard = this.guard(path);
    if (!guard.ok) return guard;
    this.files.set(path, content);
    return ok(undefined);
  }

  async deleteFile(path: string): Promise<Result<void, LoreError>> {
    const guard = this.guard(path);
    if (!guard.ok) return guard;
    this.files.delete(path);
    return ok(undefined);
  }

  /** No-op: this double has no real directories — a directory exists only while a file lives under it. */
  async removeDirIfEmpty(path: string): Promise<Result<void, LoreError>> {
    return this.guard(path);
  }

  private guard(path: string): Result<void, LoreError> {
    return this.roots === undefined ? ok(undefined) : assertInsideRoots(path, this.roots);
  }
}

/**
 * Lexically normalises a port path: collapses `.`, empty and `a/..` segments and unifies `\` to `/`.
 * Absolute paths keep their leading `/`; a relative path that climbs above its start keeps leading `..`
 * segments (so it can never be mistaken for inside a root). Pure — no Node import (browser-safe barrel).
 */
export function normalizePortPath(path: string): string {
  const unified = path.split("\\").join("/");
  const absolute = unified.startsWith("/");
  const out: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(segment);
  }
  return (absolute ? "/" : "") + out.join("/");
}

/**
 * True iff `path` lies inside (or equals) one of `roots`, compared lexically after {@link normalizePortPath}.
 * A root of `""`/`"."` is the relative-path space: it contains every relative path that does not climb out.
 */
export function isInsideRoots(path: string, roots: readonly string[]): boolean {
  const target = normalizePortPath(path);
  return roots.some((root) => {
    const base = normalizePortPath(root);
    if (base === "") return !target.startsWith("/") && target !== ".." && !target.startsWith("../");
    if (base === "/") return target.startsWith("/");
    return target === base || target.startsWith(`${base}/`);
  });
}

/** `ok` when `path` is inside `roots` (lexically), else the BR-1177 `VALIDATION_ERROR` naming the path and the roots. */
export function assertInsideRoots(path: string, roots: readonly string[]): Result<void, LoreError> {
  return isInsideRoots(path, roots) ? ok(undefined) : err(outsideRootsError(path, roots));
}

/** The BR-1177 refusal: `VALIDATION_ERROR` on `path`, message names the offending path and every root. */
export function outsideRootsError(path: string, roots: readonly string[]): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "path",
    message: `refusing to write ${path} — it is outside the write roots [${roots.join(", ")}]; nothing was written.`,
    value: path,
    rule: "BR-1177",
  };
}

/** Removes exactly one trailing `/` from `path`, if present (private path helper, not exported — `listDir` prefix matching only). */
function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
