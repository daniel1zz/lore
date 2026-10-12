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
  /** Writes `content` to `path`, creating or overwriting it wholesale (no partial/append writes). */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Removes the file at `path`; a no-op when it does not exist. Optional so read/write-only test
   * doubles stay valid; a caller that NEEDS to delete (spec-context-fragments D15 prune) must
   * refuse loudly when the port lacks it, never skip silently.
   */
  deleteFile?(path: string): Promise<void>;
  /**
   * Removes the directory at `path` ONLY when it exists and holds no entries; a no-op when it is absent
   * or non-empty (never recursive, never throws for those two cases). Optional: a port without real
   * directories (the in-memory double) may omit it, and a caller treats the cleanup as best-effort.
   */
  removeDirIfEmpty?(path: string): Promise<void>;
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

  /** @param initialFiles - Optional seed content, keyed by path (as passed to {@link readFile}). */
  constructor(initialFiles?: Record<string, string>) {
    this.files = new Map(Object.entries(initialFiles ?? {}));
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

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  /** No-op: this double has no real directories — a directory exists only while a file lives under it. */
  async removeDirIfEmpty(_path: string): Promise<void> {}
}

/** Removes exactly one trailing `/` from `path`, if present (private path helper, not exported — `listDir` prefix matching only). */
function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
