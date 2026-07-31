/**
 * Real `SetupFsReader` / `SetupFsWriter` (SPEC-046 §Design, P1 port
 * implementations) — synchronous `node:fs` backed filesystem ports for
 * `SetupService`. Mirrors `real-fs-probe.ts`'s "one real implementation
 * behind an injected port" shape (SPEC-045 §Design Decisions D4 precedent).
 *
 * Public surface:
 *   - RealSetupFsReader implements SetupFsReader
 *   - RealSetupFsWriter implements SetupFsWriter
 *
 * Invariants:
 *   - Every path handed to these ports by `SetupService` is ALREADY absolute
 *     (joined against its `targetDir` param) — neither class resolves a path
 *     against `process.cwd()`/`os.homedir()` itself.
 *   - `RealSetupFsReader.read` returns `null` for a nonexistent path (ENOENT)
 *     — this is the port's documented "not on disk" signal, not an error. Any
 *     OTHER read failure (e.g. EACCES, EISDIR) is NOT swallowed the same way:
 *     it is surfaced by re-throwing, since `SetupService` has no other way to
 *     distinguish "safe to treat as absent" from "something is actually
 *     broken" — collapsing every failure to `null` would risk `install`
 *     silently treating a permission-denied config file as "create fresh".
 *   - `RealSetupFsReader.stat` NEVER throws (mirrors `real-fs-probe.ts`'s
 *     `stat()` — ENOENT and any other stat failure both collapse to
 *     `{exists: false}`, the safe direction for `SetupService`'s
 *     `buildExistingFilesMap`, which already fails loud on an
 *     `exists:true`-with-no-sha256 contract violation but has no comparable
 *     escape hatch for a `stat` throw).
 *   - **SPEC-076 §C5, T7** — `RealSetupFsReader.listDir` (the OPTIONAL
 *     `SetupFsReader` capability `SetupService.pruneBackupRuns` needs)
 *     mirrors `read`'s ENOENT-vs-other-failure split: a missing directory
 *     resolves to `[]`, any OTHER `readdirSync` failure re-throws.
 *   - `RealSetupFsWriter.write` is ATOMIC — content is written to a sibling
 *     `<path>.tmp-<pid>-<counter>` file (never a shared/predictable name
 *     across concurrent calls in the SAME process) then renamed onto `path`
 *     via `renameSync` (POSIX atomic same-filesystem rename). A crash or
 *     throw between the tmp write and the rename leaves ONLY the orphaned
 *     tmp file behind — `path` itself is either fully absent (first-ever
 *     write) or still holds its PREVIOUS complete content; there is no
 *     window where a reader can observe a partial/zero-byte `path`.
 *   - `RealSetupFsWriter.write`'s `opts.executable` — when `true` — chmods
 *     the tmp file to `0o755` BEFORE the rename (so the executable bit is
 *     never observably absent on the final path either).
 *   - `RealSetupFsWriter.mkdir` is `fs.mkdirSync(path, {recursive: true})` —
 *     idempotent, matching the port's documented contract.
 *   - `RealSetupFsWriter.backup(src, destDir)` copies `src`'s CURRENT bytes
 *     AND its mode bits into `destDir` (same basename) via `copyFileSync`
 *     (preserves file mode on most platforms) with an explicit `chmodSync`
 *     fallback pass to guarantee mode parity regardless of platform copy
 *     semantics — `SetupService.uninstall` restores byte-identically FROM
 *     this backup, so silently dropping an executable bit here would
 *     resurrect a non-executable hook.
 *   - `RealSetupFsWriter.remove` treats a missing target as a no-op (per the
 *     port's contract) — `rmSync(path, {recursive: true, force: true})`.
 *   - `RealSetupFsWriter.removeDirIfEmpty` is `rmdirSync(path)` (NEVER
 *     `recursive`/`force`) — `ENOTEMPTY` (still has entries) and `ENOENT`
 *     (already gone) are both swallowed as the port's documented silent
 *     no-op; any OTHER errno (e.g. `EACCES`, or `ENOTDIR` if handed a file by
 *     mistake) is re-thrown, since those indicate something genuinely
 *     unexpected rather than "nothing to clean up here" (SPEC-046 AC-046-F).
 *
 * Side-effect class: IO (synchronous node:fs reads AND writes).
 * Source: SPEC-046 §Design; atomicity/backup precedent: `SetupService`'s own
 *   module doc ("the REAL implementation ... owns write ATOMICITY").
 *
 * **SPEC-060 D1/D2 addition** — `backupProjectFile`/`removeProjectPath` are
 * SYNC, standalone real implementations of the two OPTIONAL methods
 * `flows/setup-project-flow.ts`'s `ProjectFsPort` gained (`backup`/`remove`,
 * mirroring `SetupFsWriter`'s surface). They are plain functions rather than
 * a class — `ProjectFsPort`'s other four methods (`exists`/`readFile`/
 * `writeFile`/`mkdir`) are built independently by each caller of this module
 * (`commands/setup.ts`'s `makeRealProjectFs`, `project-setup-service.test.ts`'s
 * `makeRealFs` — neither file this task may edit) as a plain object literal,
 * not a class instance; a caller that wants the full backup/remove capability
 * simply spreads `{ backup: backupProjectFile, remove: removeProjectPath }`
 * into that literal. Semantics mirror `RealSetupFsWriter.backup`/`.remove`
 * above exactly (mode-preserving copy; recursive-force removal, missing
 * target is a no-op) — the only difference is these are synchronous (`void`,
 * not `Promise<void>`), matching `ProjectFsPort`'s existing sync convention
 * (`writeFile`/`mkdir` are sync there too, unlike the async `SetupFsWriter`).
 */

import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { SetupFsReader, SetupFsWriter } from "../service/setup-service.js";

/** Hex sha256 of a UTF-8 string — mirrors `SetupService`'s own private helper of the same shape. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Monotonic per-process counter so two `write()` calls in the same tick never collide on the same tmp filename. */
let tmpFileCounter = 0;

/**
 * Read-only `node:fs`-backed {@link SetupFsReader}. See module doc for the
 * `read`/`stat` failure-handling contract.
 */
export class RealSetupFsReader implements SetupFsReader {
  async read(path: string): Promise<string | null> {
    try {
      return readFileSync(path, "utf8");
    } catch (cause) {
      if (isErrnoException(cause) && cause.code === "ENOENT") return null;
      throw cause;
    }
  }

  async stat(path: string): Promise<{ exists: boolean; sha256?: string }> {
    try {
      const st = statSync(path);
      if (!st.isFile()) return { exists: false };
      const content = readFileSync(path);
      return { exists: true, sha256: createHash("sha256").update(content).digest("hex") };
    } catch {
      return { exists: false };
    }
  }

  /**
   * SPEC-076 §C5 (T7) — real implementation of `SetupFsReader`'s OPTIONAL
   * `listDir`. A missing directory resolves to `[]` (mirrors `read`'s
   * ENOENT-is-not-an-error contract); any OTHER read failure re-throws, same
   * reasoning as `read` above (a permission-denied `.lore-backups/` must not
   * be silently reported as "empty, nothing to prune").
   */
  async listDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    try {
      const dirents = readdirSync(path, { withFileTypes: true });
      return dirents.map((dirent) => ({ name: dirent.name, isDirectory: dirent.isDirectory() }));
    } catch (cause) {
      if (isErrnoException(cause) && cause.code === "ENOENT") return [];
      throw cause;
    }
  }
}

/**
 * Write-side `node:fs`-backed {@link SetupFsWriter}. See module doc for the
 * atomic-write / backup-fidelity / mkdir / remove contract.
 */
export class RealSetupFsWriter implements SetupFsWriter {
  async write(path: string, content: string, opts?: { executable?: boolean }): Promise<void> {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });

    const tmpPath = join(dir, `${basename(path)}.tmp-${process.pid}-${tmpFileCounter++}`);
    const fd = openSync(tmpPath, "w");
    try {
      writeSync(fd, content, null, "utf8");
    } finally {
      closeSync(fd);
    }

    if (opts?.executable) {
      chmodSync(tmpPath, 0o755);
    }

    renameSync(tmpPath, path);
  }

  async mkdir(path: string): Promise<void> {
    mkdirSync(path, { recursive: true });
  }

  async backup(src: string, destDir: string): Promise<void> {
    mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, basename(src));
    copyFileSync(src, destPath);
    const srcMode = statSync(src).mode;
    chmodSync(destPath, srcMode);
  }

  async remove(path: string, opts?: { boundary?: string }): Promise<void> {
    const self = lstatOrNull(path);
    if (self === null) return;

    // D2 — a target that IS a link is unlinked. `rmSync` already happens to do
    // this, but going through `unlinkSync` states the intent at the call site
    // instead of relying on a recursive-force removal to be link-shaped.
    if (self.isSymbolicLink()) {
      unlinkSync(path);
      return;
    }

    // D3/D4 — never reach THROUGH a link. Without this, a developer who
    // symlinks an install subdirectory into their own repo has that repo's
    // file deleted: `existsSync` (the previous guard) follows links, so the
    // far-side file looked like an installed copy. Measured twice on this repo.
    if (opts?.boundary !== undefined) {
      const link = findSymlinkAncestor(path, opts.boundary);
      if (link !== null) {
        throw new Error(
          `refusing to remove ${path}: ancestor ${link} is a symlink, so removing through it would delete the LINK TARGET's file, not an installed copy. ` +
            `Nothing was removed. If the install really should own that path, unlink ${link} first.`,
        );
      }
    }

    rmSync(path, { recursive: true, force: true });
  }

  async removeDirIfEmpty(path: string): Promise<void> {
    const self = lstatOrNull(path);
    if (self === null) return;

    // D6 — a symlink is not a directory this sweep emptied, so it is left
    // exactly as the developer created it. `rmdirSync` on a link raises
    // ENOTDIR, which used to escape the swallow list and abort the whole run
    // AFTER an irreversible removal had already committed.
    if (self.isSymbolicLink()) return;

    try {
      rmdirSync(path);
    } catch (cause) {
      if (
        isErrnoException(cause) &&
        (cause.code === "ENOTEMPTY" || cause.code === "ENOENT" || cause.code === "ENOTDIR")
      ) {
        return;
      }
      throw cause;
    }
  }
}

/**
 * `lstatSync` narrowed to the port's "absent target is a no-op" contract —
 * link-aware by construction, so a DANGLING link (whose target is gone) is
 * still reported as present. `existsSync` cannot express that: it follows the
 * link and answers `false`, which is why dangling links were previously
 * skipped and left behind forever.
 *
 * @returns The `Stats` of the path itself, or `null` when nothing is there.
 * @throws Any non-ENOENT stat failure (e.g. EACCES) — the same
 *   fail-loud-on-the-unexpected split `RealSetupFsReader.read` uses.
 */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === "ENOENT") return null;
    throw cause;
  }
}

/**
 * Walks `target`'s ancestors upward, STRICTLY inside `boundary`, and returns
 * the first one that is a symlink.
 *
 * The scan stops at `boundary` rather than at the filesystem root on purpose
 * (spec D4): a developer whose entire `~/.claude` is itself a symlink is a
 * legitimate setup with nothing to do with this defect, and scanning past the
 * install root would refuse every removal for them.
 *
 * @param target - Absolute path being removed.
 * @param boundary - Absolute install root; ancestors at or above it are not scanned.
 * @returns The offending ancestor path, or `null` when the chain is link-free
 *   (including when `target` sits directly in `boundary`, or outside it).
 * @throws Any non-ENOENT stat failure encountered while walking.
 */
function findSymlinkAncestor(target: string, boundary: string): string | null {
  const root = resolve(boundary);
  const resolvedTarget = resolve(target);
  const rel = relative(root, resolvedTarget);

  // A target that does not resolve INSIDE the boundary means the caller paired a
  // path with a boundary it does not belong to. Returning `null` there — the
  // original behaviour — silently skips the ancestor scan, i.e. quietly drops the
  // protection at exactly the moment the arguments stopped making sense. Review
  // found this reachable on a case-insensitive filesystem (macOS APFS default):
  // a boundary differing only in case makes the prefix comparison false, the scan
  // is skipped, and a removal proceeds THROUGH a symlink. Every current call site
  // derives both strings from one source so none can hit it today, but the
  // primitive must fail loud rather than fail open.
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `refusing to remove ${target}: it does not resolve inside the declared boundary ${boundary} (relative path "${rel}"). ` +
        `Nothing was removed. This is a caller error — the symlink-ancestor protection cannot be applied to a path outside its own boundary, ` +
        `and skipping the check silently would reinstate the reach-through deletion this guard exists to prevent.`,
    );
  }

  // The target IS the boundary — there are no ancestors inside it to scan.
  if (rel === "") return null;

  const prefix = root + sep;
  let current = dirname(resolvedTarget);

  while (current !== root && current.startsWith(prefix)) {
    const stats = lstatOrNull(current);
    if (stats !== null && stats.isSymbolicLink()) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/** Narrow type guard for a Node `fs` errno exception (`{code: string}`), without importing `node:fs`'s internal error type. */
function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

// ─── SPEC-060 D1/D2 — sync ProjectFsPort.backup/.remove real implementations ─

/**
 * Real, synchronous implementation of `ProjectFsPort.backup` (SPEC-060 D1) —
 * copies `src`'s CURRENT bytes AND mode bits into `destDir` (same basename).
 * Mirrors {@link RealSetupFsWriter.backup} exactly, minus the `Promise`
 * wrapper (`ProjectFsPort` is sync). Callers (the manifest write seam in
 * `flows/setup-project-flow.ts`) always `mkdir(destDir)` first — this
 * function does not create `destDir` itself, matching the machine-installer
 * counterpart's division of labor.
 *
 * @throws When `src` does not exist or is unreadable, or `destDir` cannot be
 *   written to — never swallowed; the caller is responsible for treating a
 *   thrown backup as a loud, per-path failure (never a silent skip).
 */
export function backupProjectFile(src: string, destDir: string): void {
  const destPath = join(destDir, basename(src));
  copyFileSync(src, destPath);
  const srcMode = statSync(src).mode;
  chmodSync(destPath, srcMode);
}

/**
 * Real, synchronous implementation of `ProjectFsPort.remove` (SPEC-060 D1/D2)
 * — removes the file or directory (recursively) at `path`; a missing target
 * is a no-op. Mirrors {@link RealSetupFsWriter.remove} exactly, minus the
 * `Promise` wrapper — INCLUDING its symlink safety
 * (spec-lore-setup-deletes-repo-source-through-dev-symlinks D1-D4).
 *
 * The symlink rules are duplicated here rather than left to the machine-install
 * writer because this function carries the SAME `existsSync` + `rmSync` shape
 * that deleted this repo's own source: `lore setup --project --uninstall` feeds
 * it repo-relative tracked paths, so a developer who symlinks any scaffolded
 * path (`.claude/hooks`, say) elsewhere would have the link TARGET deleted.
 * Lower probability than the machine-install case, identical failure mode.
 *
 * @param path - Absolute path to remove.
 * @param opts - `boundary` is the repo root; when supplied, a path whose
 *   ancestor inside it is a symlink is REFUSED rather than followed.
 * @throws When `opts.boundary` is given and an ancestor inside it is a symlink
 *   (nothing is removed), or on a genuine IO failure.
 */
export function removeProjectPath(path: string, opts?: { boundary?: string }): void {
  const self = lstatOrNull(path);
  if (self === null) return;

  if (self.isSymbolicLink()) {
    unlinkSync(path);
    return;
  }

  if (opts?.boundary !== undefined) {
    const link = findSymlinkAncestor(path, opts.boundary);
    if (link !== null) {
      throw new Error(
        `refusing to remove ${path}: ancestor ${link} is a symlink, so removing through it would delete the LINK TARGET's file, not a scaffolded copy. ` +
          `Nothing was removed. If the scaffold really should own that path, unlink ${link} first.`,
      );
    }
  }

  rmSync(path, { recursive: true, force: true });
}
