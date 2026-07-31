/**
 * Repo-level uninstall reversal for `lore setup --project --uninstall`
 * (SPEC-060 §Design D2). Reverses a prior `lore setup --project` run STRICTLY
 * via the repo-level install ledger that run wrote (D1, `.lore/.lore-project-manifest.json`)
 * — for each tracked entry: a backup found under `.lore/.lore-backups/<written_at>/`
 * is restored byte-identically; its absence means the entry was created fresh
 * by lore, so it is simply removed. The whole backups tree is removed once
 * every entry is processed, and the manifest itself is deleted LAST — mirrors
 * `SetupService.uninstall`'s manifest-last reversal discipline
 * (`packages/lore/src/service/setup-service.ts`) at the repo-target tier.
 *
 * ⚠ CONCURRENT-DISPATCH INTERFACE NOTE (SPEC-060 plan T1/T3 sequencing) — this
 * module was authored while sibling task T1 ("repo-level install ledger core
 * (D1) + ProjectFsPort backup/remove") was concurrently landing its own
 * changes to `./setup-project-flow.ts` (a file THIS task is explicitly
 * forbidden from touching — anchor mutex). Per the spec's Design section
 * ("`ProjectFsPort` gains `backup(src, destDir)` and `remove(path)` to
 * support D1/D2, mirroring `SetupFsWriter`'s surface"), `ProjectFsPort` is
 * expected to grow a `remove` method there. Rather than editing that file,
 * this module declares its OWN minimal `remove` extension via a type
 * intersection ({@link ProjectFsRemovePort} = `ProjectFsPort & {remove...}`)
 * — structurally satisfied by T1's real, eventually-landed port (a redundant,
 * never conflicting, member) and independently satisfiable by a real/fake
 * port TODAY, so this module compiles and is fully testable ahead of the
 * merge. It deliberately does NOT need `backup` — uninstall only ever
 * RESTORES (reads bytes already written to a backup file by a prior install)
 * or REMOVES; it never creates a new backup itself.
 *
 * ⚠ MANIFEST PATH SSOT (SPEC-060 T5 follow-up, fixes an initial SSOT
 * violation) — this module now imports `PROJECT_MANIFEST_RELATIVE_PATH` and
 * `PROJECT_BACKUPS_RELATIVE_DIRNAME` directly from `./setup-project-flow.js`
 * (T1's landed repo-level install ledger) instead of maintaining its own
 * copy of those literals. It parses via the SAME `setupManifestSchema` the
 * machine-target installer uses. (History: this module was originally
 * authored concurrently with T1 while `setup-project-flow.ts` was off-limits
 * under the anchor mutex, so it declared its own hardcoded duplicates —
 * `PROJECT_MANIFEST_FILENAME`/`PROJECT_BACKUPS_DIRNAME` — as a stopgap.
 * `PROJECT_BACKUPS_RELATIVE_DIRNAME` did not previously exist as an export;
 * this task adds it, mirroring the already-exported
 * `PROJECT_MANIFEST_RELATIVE_PATH`, so both flows share one literal.)
 *
 * ⚠ RESTORE FILE MODE ASSUMPTION — a restored file's POSIX mode is not part
 * of `SetupEntry` (only `path`/`kind`/`sha256`/`written_at`), so this module
 * derives it from `entry.kind` via {@link restoreModeForKind}: `"hook"` ->
 * 0o755 (executable, mirroring `setup-project-flow.ts`'s existing
 * `HOOK_FILE_MODE`), everything else -> 0o644 (mirrors that file's
 * `TREE_YAML_MODE`). If T1/T2 tag repo hook entries with a different kind
 * literal, update `restoreModeForKind` to match.
 *
 * Public surface:
 *   ProjectFsRemovePort    — the `remove` extension this module needs
 *   ProjectUninstallReport — restored[]/removed[]/manifestPath outcome
 *   uninstallProject(fs, opts) — the reversal entry point
 *
 * Invariants:
 *   - Reverses STRICTLY via the manifest — no second source of truth is ever
 *     consulted (SPEC-060 D2's core constraint).
 *   - No manifest at `repoDir/.lore/<filename>` -> fails loud
 *     (`VALIDATION_ERROR`, "nothing to uninstall") rather than silently
 *     no-op'ing (mirrors `SetupService.uninstall`'s identical rule).
 *   - The restore/remove loop is wrapped in ONE try/catch — a thrown fs call
 *     stops the loop immediately and aborts with `STORE_ERROR` naming exactly
 *     how many entries had already been reversed before the failure (mirrors
 *     `SetupService.uninstall`'s fault-injection contract). The manifest is
 *     provably never reached in this path (manifest-last ordering) — a
 *     subsequent retry re-reads the SAME manifest and can converge.
 *   - `uninstallProject` never throws or rejects — every failure mode
 *     surfaces as `err(...)`.
 *
 * Side-effect class: IO (delegates entirely to the injected fs port)
 * Source: SPEC-060 §Design D2, task `task-t3-lore-setup-project-uninstall-verb-d2`
 */

import { dirname, join } from "node:path";
import { err, ok, setupManifestSchema } from "@lore/core";
import type { LoreError, Result, SetupEntryKind } from "@lore/core";
import {
  PROJECT_BACKUPS_RELATIVE_DIRNAME,
  PROJECT_MANIFEST_RELATIVE_PATH,
} from "./setup-project-flow.js";
import type { ProjectFsPort } from "./setup-project-flow.js";

// ─── Ports ───────────────────────────────────────────────────────────────────

/**
 * Extends {@link ProjectFsPort} with the ONE additional capability this flow
 * needs — see this module's header for why an intersection type is used
 * rather than editing `ProjectFsPort` itself.
 */
export type ProjectFsRemovePort = ProjectFsPort & {
  /**
   * Removes the file OR directory (recursively) at `path`. A missing target is
   * NOT an error. MAY throw on a genuine IO failure.
   *
   * `opts.boundary` — the repo root, REQUIRED (D8). The implementation MUST
   * refuse (throw) rather than remove a path whose ancestor inside that
   * boundary is a symlink: following such a link deletes the LINK TARGET's file
   * instead of a scaffolded copy. Required so a forgotten boundary is a COMPILE
   * error at every call site rather than a silent skip of the ancestor scan —
   * `tsc` enumerates callers, a remembered list of call sites does not
   * (spec-lore-setup-deletes-repo-source-through-dev-symlinks D3/D4/D8).
   */
  remove(path: string, opts: { boundary: string }): void;
};

/** Per-call uninstall target — mirrors `ProjectScaffoldOptions`'s shape in `setup-project-flow.ts`. */
export interface ProjectUninstallOptions {
  /** Absolute path to the target git repository root. */
  repoDir: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
// Manifest/backups path fragments are imported from `setup-project-flow.ts`
// (the SSOT — see module header). Only mode literals are declared here.

const DEFAULT_FILE_MODE = 0o644;
const HOOK_FILE_MODE = 0o755;

/** Derives the POSIX mode a restored file should be written with — see module header assumption. */
function restoreModeForKind(kind: SetupEntryKind): number {
  return kind === "hook" ? HOOK_FILE_MODE : DEFAULT_FILE_MODE;
}

// ─── Report shape ────────────────────────────────────────────────────────────

/** The full outcome of one {@link uninstallProject} call. */
export interface ProjectUninstallReport {
  /** Repo-relative paths restored byte-identically from a backup. */
  restored: string[];
  /** Repo-relative paths removed outright — no backup existed (created fresh by a prior scaffold run). */
  removed: string[];
  /** Absolute path to the manifest that was consulted (and, on success, removed). */
  manifestPath: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Renders a thrown value's message. Never throws. Mirrors `setup-project-flow.ts`'s `toMessage`. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Reverses a prior `lore setup --project` run against `opts.repoDir`,
 * strictly via the repo-level install ledger it wrote (D1). See module doc
 * for the full per-entry restore/remove contract and the manifest-last
 * ordering.
 *
 * @param fs - The narrow fs port (`ProjectFsPort` + `remove`), adapter-provided.
 * @param opts - `{ repoDir }` — the absolute path to the target repo root.
 * @returns `ok(report)` on success, or `err(VALIDATION_ERROR)` for a
 *   malformed `repoDir` or a missing/malformed manifest, or `err(STORE_ERROR)`
 *   for a mid-reversal fs failure.
 * @example
 * const result = await uninstallProject(fs, { repoDir: "/path/to/repo" });
 * if (result.ok) console.log(result.value.restored, result.value.removed);
 */
export async function uninstallProject(
  fs: ProjectFsRemovePort,
  opts: ProjectUninstallOptions,
): Promise<Result<ProjectUninstallReport, LoreError>> {
  const { repoDir } = opts;
  if (!repoDir || !repoDir.startsWith("/")) {
    return err({
      code: "VALIDATION_ERROR",
      field: "repoDir",
      message: "repoDir must be a non-empty absolute path",
      value: repoDir,
    });
  }

  const manifestPath = join(repoDir, PROJECT_MANIFEST_RELATIVE_PATH);
  const manifestRaw = fs.readFile(manifestPath);
  if (manifestRaw === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `no project setup manifest found at "${manifestPath}" — nothing to uninstall`,
      value: manifestPath,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(manifestRaw);
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `manifest at "${manifestPath}" is not valid JSON: ${toMessage(cause)}`,
      value: manifestPath,
    });
  }

  const manifestResult = setupManifestSchema.safeParse(parsedJson);
  if (!manifestResult.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `manifest at "${manifestPath}" failed schema validation: ${manifestResult.error.message}`,
      value: manifestPath,
    });
  }
  const manifest = manifestResult.data;

  const restored: string[] = [];
  const removed: string[] = [];

  try {
    for (const entry of manifest.entries) {
      const fullPath = join(repoDir, entry.path);
      const backupPath = join(repoDir, PROJECT_BACKUPS_RELATIVE_DIRNAME, entry.written_at, entry.path);

      if (fs.exists(backupPath)) {
        const backupContent = fs.readFile(backupPath);
        if (backupContent === null) {
          throw new Error(`backup at "${backupPath}" reported exists but could not be read`);
        }
        fs.mkdir(dirname(fullPath));
        fs.writeFile(fullPath, backupContent, restoreModeForKind(entry.kind));
        restored.push(entry.path);
      } else {
        fs.remove(fullPath, { boundary: opts.repoDir });
        removed.push(entry.path);
      }
    }

    fs.remove(join(repoDir, PROJECT_BACKUPS_RELATIVE_DIRNAME), { boundary: opts.repoDir });
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message:
        `lore setup --project --uninstall: reversal failed after restoring ${restored.length} and removing ` +
        `${removed.length} tracked path(s): ${toMessage(cause)}`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  try {
    fs.remove(manifestPath, { boundary: opts.repoDir });
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message:
        `lore setup --project --uninstall: file reversal completed, but removing the manifest at ` +
        `"${manifestPath}" failed: ${toMessage(cause)}. Re-run --uninstall to retry manifest removal.`,
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  return ok({ restored, removed, manifestPath });
}
