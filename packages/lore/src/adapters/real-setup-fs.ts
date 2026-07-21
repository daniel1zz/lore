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
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

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

  async remove(path: string): Promise<void> {
    if (!existsSync(path)) return;
    rmSync(path, { recursive: true, force: true });
  }

  async removeDirIfEmpty(path: string): Promise<void> {
    try {
      rmdirSync(path);
    } catch (cause) {
      if (isErrnoException(cause) && (cause.code === "ENOTEMPTY" || cause.code === "ENOENT")) return;
      throw cause;
    }
  }
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
 * `Promise` wrapper.
 */
export function removeProjectPath(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
}
