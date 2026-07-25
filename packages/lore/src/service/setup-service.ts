/**
 * SetupService — global-machine installer for `lore setup` (SPEC-046 §Design,
 * §Scope "P1 installer"). Wires the vendored `assets/` SSOT tree (skills,
 * agents, hooks, governance snippet) plus a `settings.json` hook merge and a
 * `claude mcp` registration into an existing Claude Code install directory
 * ("target dir", conventionally `~/.claude` in production — NEVER read from
 * `homedir()`/env by this module, see invariants below).
 *
 * Public surface:
 *   - SetupService — stateless, constructor-injected ports (AssetSource,
 *     SetupFsReader, SetupFsWriter, McpRegistrar)
 *       .planInstall(opts)  — dry-run; reader-only, zero writer-port calls
 *       .install(opts, now?) — materializes the payload, manifest-authoritative
 *       .uninstall(opts, now?) — reverses STRICTLY via the manifest
 *   - AssetSource / SetupFsReader / SetupFsWriter / McpRegistrar — the four
 *     injected ports (real implementations are a DOWNSTREAM task; this module
 *     only depends on the interfaces + whatever fakes its own test suite builds)
 *   - SetupReceipt — the outcome shape returned by both `install` and `uninstall`
 *   - assertSafeTargetDir(targetDir) — the test-pollution safety guard
 *
 * Invariants:
 *   - `targetDir` is a RESOLVED string parameter on every method — this module
 *     NEVER calls `os.homedir()` or reads `process.env.CLAUDE_CONFIG_DIR`
 *     itself; that resolution (`--claude-dir` > `$CLAUDE_CONFIG_DIR` >
 *     `homedir()`) lives in the CLI adapter (SPEC-046 §Design).
 *   - `assertSafeTargetDir` REFUSES a `targetDir` that is or is inside the
 *     REAL `os.homedir()/.claude` unless `process.env.LORE_SETUP_ALLOW_REAL
 *     === "1"` (the production escape hatch — a real `lore setup` run DOES
 *     target `~/.claude`). Every public method calls this FIRST, before any
 *     port call — this is this task's dedicated test-pollution guard (mirrors
 *     the 2026-07-07 "never write to the repo's own corpus from a test" rule
 *     for this service's own real-world target).
 *   - `planInstall` holds `this.writer` on the SAME instance as `install`/
 *     `uninstall` (one constructor, four ports — the ports are NOT split
 *     across separate classes) — the "planInstall receives reader only"
 *     guarantee is an IMPLEMENTATION DISCIPLINE (planInstall's body never
 *     references `this.writer`/`this.mcpRegistrar`), verified at runtime by
 *     this module's own test suite via a poisoned writer fake that throws on
 *     any method call (SPEC-046 invariant I4).
 *   - `install` plans the ENTIRE run (asset load, settings.json merge,
 *     manifest read, on-disk sha probing, the pure `planInstall` decision)
 *     BEFORE issuing a single `SetupFsWriter` call — a `mergeSettings` failure
 *     (malformed existing `settings.json`) aborts with ZERO writer calls
 *     (invariant I1). The manifest is written LAST, and only when its
 *     computed content differs from the on-disk manifest (a fully
 *     byte-identical re-run therefore issues ZERO writer calls at all —
 *     invariant I2).
 *   - Every `SetupEntry.sha256` is computed by THIS service over the FINAL
 *     content string handed to `SetupFsWriter.write` (post-merge for a
 *     `settings-hook` entry) — never trusted from the raw `AssetPayload`
 *     (invariant I5). `sha256Hex` (`node:crypto`) is fine to use here — only
 *     `@lore/core` must stay browser-safe, not this service package.
 *   - Fault injection: the backup+write+removal loop is wrapped in ONE
 *     try/catch. A thrown `SetupFsWriter` call (e.g. write #2 of 3) stops the
 *     loop immediately (later entries are NEVER attempted) and aborts with
 *     `STORE_ERROR` naming exactly what committed before the failure — the
 *     manifest is provably never reached in this path (manifest-last
 *     ordering). A subsequent `install()` call against the same target
 *     re-plans from the current (partial) on-disk state and converges
 *     (invariant I2's general form).
 *   - `uninstall` reverses STRICTLY via the manifest (no other source of
 *     truth) — for each tracked non-mcp entry it looks for a backup at
 *     `<targetDir>/.lore-backups/<entry.written_at>/<entry.path>` (the
 *     `written_at` timestamp doubles as the backup-run directory key, since
 *     `install` uses ONE `now()` value for both the backup directory name and
 *     every entry it writes that run — no separate index/listing needed).
 *     A found backup is restored byte-identically; its absence means the
 *     entry was created fresh by lore (nothing to restore), so it is simply
 *     removed. The whole `.lore-backups` tree is removed once every entry is
 *     processed, then the manifest itself is deleted LAST (mirrors install's
 *     manifest-last discipline in reverse — the manifest stays valid/authoritative
 *     until every other reversal has succeeded).
 *   - `uninstall` additionally prunes now-EMPTY directories it created
 *     (AC-046-F finding — a reversible install must return `targetDir` to its
 *     true pre-install state, not leave empty directory skeletons like
 *     `skills/`/`agents/` behind). Candidate directories are every ANCESTOR
 *     (up to but excluding `targetDir`) of every entry that was REMOVED
 *     outright this run (i.e. `removedPaths` — entries restored FROM a backup
 *     never contribute, since their parent dir predates this install and is
 *     never "ours" to prune). Candidates are deduped and swept DEEPEST-FIRST
 *     (longest path first) via `SetupFsWriter.removeDirIfEmpty`, which is
 *     empty-only and NEVER force-removes — a directory with any remaining
 *     content (including a sibling lore-tracked file, or unrelated
 *     user content) is left untouched, and the sweep naturally cascades
 *     upward (`skills/lore/` empties out and is removed, which may then make
 *     `skills/` itself empty and removable next).
 *     **Known simplification (documented, not a bug)**: this rule has no
 *     directory-provenance tracking — it cannot distinguish "this directory
 *     was created BY this install" from "this directory pre-existed and
 *     happened to become empty once our files were removed from it" (e.g. a
 *     user's own empty `skills/` dir that install put lore's files into,
 *     later left empty by uninstall). Both are pruned identically. This is
 *     considered acceptable: the only way to preserve a pre-existing empty
 *     directory would be recording directory ownership in the manifest
 *     (a real design, out of scope for this fix) — the guarantee this fix
 *     DOES make is unconditional: a directory with ANY remaining content,
 *     lore-tracked or foreign, is never removed.
 *   - No manifest at `targetDir` → `uninstall` fails loud (`VALIDATION_ERROR`,
 *     "nothing to uninstall") rather than silently no-op'ing.
 *   - MCP registration/de-registration failure is NEVER thrown and never
 *     aborts the run — `SetupReceipt.mcp` records `"failed"` and the CALLER
 *     (CLI adapter) is responsible for mapping that to a non-zero exit code;
 *     every file-asset write still completes.
 *   - **SPEC-076 T5 — converge-semantics hardening.** `install()` ALWAYS uses
 *     `computeInstallPlan` (`planInstall`) for the base writes/skips/backups
 *     decision (fresh install and re-converge alike — the write PLANNER never
 *     changes); when an installed manifest already exists (`current !== null`
 *     — the UPDATE path, D3: a fresh install has no "diverged" concept at
 *     all), that plan is ADDITIONALLY overlaid with `@lore/core`'s pure
 *     five-state `planUpdate` classifier (private `classifyManagedDivergence`
 *     below) to identify which of `plan.writes` are `diverged` (user-edited
 *     since the last converge, per SPEC-076 §C3) — those are REMOVED from the
 *     write/backup set and reported via `SetupReceipt.skippedDiverged`
 *     instead of being silently overwritten (§C3 D2), UNLESS
 *     `opts.forceDiverged` is set, in which case they flow through the write
 *     path unchanged (backup-then-overwrite, identical to an `outdated`
 *     entry). `classifyManagedDivergence` deliberately calls `planUpdate`
 *     with the on-disk manifest's `assets_digest` field STRIPPED — see that
 *     function's own doc for why trusting it here would defeat this very
 *     detection.
 *   - **SPEC-076 T5 — manifest version fields (§C4), stamped LAST, always.**
 *     `binary_version` (the running binary's embedded `LORE_BINARY_VERSION`)
 *     and `installed_at` (this run's `nowIso`) are written on EVERY
 *     successful converge, fresh install or update alike. `assets_digest`
 *     (the embedded tree's whole-tree `tree_digest`) is written ONLY when
 *     `skippedDiverged` is empty this run — stamping it while a diverged
 *     file remains un-overwritten would let `lore setup --check`'s digest
 *     short-circuit (`@lore/core`'s `planUpdate`) wrongly report the target
 *     fully `"sync"` despite a known, un-repaired divergence; omitting the
 *     field (rather than writing a stale/incorrect value) is the fail-loud
 *     direction here — a reader missing `assets_digest` must fall back to
 *     full per-entry classification, never assume sync.
 *   - **SPEC-076 T5 — check-cache invalidation.** A converge that actually
 *     wrote/removed anything (asset files OR the manifest itself) removes
 *     `<targetDir>/.lore-setup-check.json` (the `lore setup --check` cache,
 *     T4) as its FINAL step — a stale cache claiming `"sync"` must not
 *     outlive the state it described. A fully idempotent re-run (I2 — zero
 *     underlying writes) makes ZERO calls here too, preserving I2's "byte-
 *     identical re-run fires zero writer calls" invariant; a failure to
 *     remove an already-absent/permission-denied cache file is swallowed
 *     (best-effort — the cache is purely advisory, C6's fail-open posture;
 *     a stale cache self-corrects on its own 24h TTL or the NEXT successful
 *     converge).
 *   - **SPEC-076 §C5, T7 — orphan pruning + backup hygiene.** `install()`
 *     wires a `hooksPathPrefix` (`"<targetDir>/hooks/"`) into every
 *     `settings-hook` asset's `mergeSettings` call (`resolvePayload`) so a
 *     PAST lore hook registration no longer present in the current asset
 *     payload at all (renamed/removed upstream) is pruned instead of
 *     surviving forever as a dead entry — see `@lore/core`'s
 *     `merge-settings.ts` for the pure matching rule. Separately, a
 *     successful write phase is ALWAYS followed by `pruneBackupRuns`,
 *     trimming `<targetDir>/.lore-backups/` to the `BACKUP_RUNS_KEEP` (5)
 *     most recent run directories — best-effort (a thrown failure here is
 *     caught and degraded to an advisory stderr line, NEVER a failed
 *     install; this task's own Scope-Alt). `SetupFsReader.listDir` (the port
 *     method this needs) is OPTIONAL/additive — a reader that doesn't
 *     implement it makes pruning a silent no-op, never an error.
 *
 * Side-effect class: IO (delegates ALL of it to the four injected ports —
 *   this class itself makes no direct `fs`/`child_process` calls).
 *
 * Source: SPEC-046 §Design ("`service/setup-service.ts`"), §Scope, invariants I1–I5.
 *   SPEC-076 §C3 (five-state converge hardening), §C4 (manifest version
 *   fields), §C5 (orphan pruning + backup hygiene, T7), §C7, D2 —
 *   task task-skill-implement-t5-converge-hardening-diverged-skip-force,
 *   task-skill-implement-t7-mergesettings-orphan-pruning-backup.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

import { err, ok } from "@lore/core";
import type { Result, LoreError } from "@lore/core";
import {
  planInstall as computeInstallPlan,
  planUpdate,
  setupManifestSchema,
  mergeSettings,
} from "@lore/core";
import type {
  AssetFile,
  AssetPayload,
  InstallPlan,
  PlannedWrite,
  SetupEntry,
  SetupManifest,
  SettingsHookEntry,
  UpdatePlan,
  UpdateProbe,
} from "@lore/core";

import { EMBEDDED_ASSETS_MANIFEST, LORE_BINARY_VERSION } from "../generated/assets-manifest.js";

// ─── Ports ───────────────────────────────────────────────────────────────────

/**
 * Loads the in-memory asset set a `lore setup` run intends to install. The P1
 * production implementation reads the repo's vendored `assets/` tree
 * (downstream task); a P3 implementation could swap to a binary-embedded
 * payload WITHOUT this service changing at all.
 *
 * @invariant For a `kind: "settings-hook"` entry, `content` is a
 *   JSON-serialized `SettingsHookEntry[]` (the desired lore-managed hook
 *   registrations) — NOT the raw `settings.json` text. `SetupService` parses
 *   this and merges it against the ON-DISK `settings.json` via `mergeSettings`;
 *   see {@link SetupService}'s module doc.
 */
export interface AssetSource {
  load(): Promise<Result<AssetPayload, LoreError>>;
}

/**
 * Read-only filesystem view. `planInstall` is constructed to use ONLY this
 * port (see {@link SetupService} module invariants) — it structurally cannot
 * write, by discipline plus a runtime-verified test double.
 */
export interface SetupFsReader {
  /** Reads full file content at an ABSOLUTE path. Returns `null` when the file does not exist. */
  read(path: string): Promise<string | null>;
  /**
   * Classifies an ABSOLUTE path. `sha256` MUST be present whenever
   * `exists: true` — a caller that cannot compute it should NOT report
   * `exists: true` (`SetupService` fails loud rather than guessing when this
   * contract is violated).
   */
  stat(path: string): Promise<{ exists: boolean; sha256?: string }>;
  /**
   * OPTIONAL (SPEC-076 §C5, T7, additive) — lists the IMMEDIATE entries of
   * an ABSOLUTE directory path (never recursing into subdirectories). A
   * missing directory resolves to `[]` — silent, mirroring
   * `SetupFsWriter.removeDirIfEmpty`'s "missing target is a no-op" contract
   * — never an error. Absent on a `SetupFsReader` implementation that
   * predates this capability (every pre-T7 fake in this codebase's test
   * suites); `SetupService`'s backup-hygiene sweep (`pruneBackupRuns`)
   * treats a missing `listDir` as "pruning unsupported by this port" and
   * silently no-ops rather than failing the install — the SAME
   * optional-capability-detection shape `GateEnforcer`/`claimTtlMinutes?`
   * already use elsewhere in this codebase (see `service/CLAUDE.md`), not a
   * new pattern.
   */
  listDir?(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
}

/**
 * Write-side filesystem port. Only `install`/`uninstall` hold a reference to
 * this — `planInstall` never does (see module invariants). The REAL
 * implementation (a downstream task) owns write ATOMICITY (tmp file + rename)
 * — this interface makes no atomicity guarantee itself.
 */
export interface SetupFsWriter {
  /** Writes `content` to an ABSOLUTE path, creating/replacing it. */
  write(path: string, content: string, opts?: { executable?: boolean }): Promise<void>;
  /** Creates a directory (and any missing parents) at an ABSOLUTE path. Idempotent. */
  mkdir(path: string): Promise<void>;
  /** Copies the file currently at ABSOLUTE `src` into ABSOLUTE directory `destDir`, preserving its basename. */
  backup(src: string, destDir: string): Promise<void>;
  /** Removes the file OR directory (recursively) at an ABSOLUTE path. A missing target is NOT an error. */
  remove(path: string): Promise<void>;
  /**
   * Removes the directory at ABSOLUTE `path` IFF it is currently empty — NEVER
   * force/recursive (unlike {@link remove}). A path that still has entries, or
   * that does not exist at all, is a silent no-op — NOT an error — so a caller
   * can sweep a whole candidate ancestor-directory set without pre-checking
   * emptiness itself (see `SetupService.uninstall`'s post-reversal directory
   * cleanup, SPEC-046 AC-046-F). Any OTHER failure (e.g. permission denied) is
   * surfaced by throwing.
   */
  removeDirIfEmpty(path: string): Promise<void>;
}

/**
 * Registers/de-registers the `lore` MCP server with the `claude` CLI at user
 * scope. The production implementation shells `claude mcp add`/`claude mcp
 * remove` (argv built by `@lore/core`'s `buildMcpAddArgs`/`buildMcpRemoveArgs`)
 * — a downstream task, not this one.
 */
export interface McpRegistrar {
  add(binPath: string): Promise<Result<void, LoreError>>;
  remove(): Promise<Result<void, LoreError>>;
}

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Outcome of one {@link SetupService.install} or {@link SetupService.uninstall}
 * call. The SAME shape serves both directions with slightly different field
 * meanings (documented per-field below) — a deliberate reuse per SPEC-046's
 * pinned contract, rather than two near-identical result types.
 */
export interface SetupReceipt {
  /**
   * install(): manifest entries actually written this run (excludes the mcp
   * entry — see `mcp` below). uninstall(): always `[]` (nothing is "written"
   * in the asset sense during a reversal).
   */
  written: SetupEntry[];
  /**
   * install(): paths already byte-identical to their intended final content —
   * no write needed. uninstall(): paths removed outright because no backup
   * existed for them (they were created fresh by a prior `install`, so there
   * was nothing to restore).
   */
  skipped: string[];
  /**
   * install(): paths backed up before being overwritten, this run.
   * uninstall(): paths successfully restored FROM a backup.
   */
  backups: string[];
  /**
   * Outcome of the MCP registrar step this run: `"registered"` — the add/remove
   * call succeeded; `"failed"` — it was attempted and threw/returned `err`
   * (file-asset work still completed; the CLI adapter maps this to a non-zero
   * exit); `"skipped"` — uninstall found no tracked `mcp` manifest entry, so no
   * de-registration was attempted.
   */
  mcp: "registered" | "skipped" | "failed";
  /** Absolute path to `.lore-setup-manifest.json` under the target dir. */
  manifestPath: string;
  /**
   * install(): managed-ownership paths this run classified as `diverged`
   * (SPEC-076 §C3 — on-disk bytes differ from BOTH the target content AND
   * the last-recorded manifest sha, i.e. user-edited since the last
   * converge) and therefore did NOT overwrite, per §C3 D2's default-skip
   * policy. Always `[]` on a fresh install (no prior manifest — D3, the
   * "diverged" concept does not apply) and whenever `--force-diverged` was
   * passed (every diverged path is routed through the normal
   * backup-then-overwrite path instead, same as an `outdated` entry).
   * uninstall(): always `[]` — the concept does not apply to a reversal.
   */
  skippedDiverged: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * `<targetDir>/.lore-setup-manifest.json` — exported (SPEC-076 T5) so
 * `../adapters/cli/setup-check.ts` (T4, a concurrently-claimed sibling task
 * at the time this constant was private) can import the single SSOT literal
 * instead of carrying its own documented duplicate. See that module's own
 * header for the migration note.
 */
export const MANIFEST_FILENAME = ".lore-setup-manifest.json";
const MANIFEST_VERSION = "1";
const BACKUPS_DIRNAME = ".lore-backups";
/**
 * `.lore-backups/` run-directory retention count (SPEC-076 §C5, T7) — the
 * 6th-oldest-and-beyond conforming run directory is pruned on every
 * successful `install()` call. See `pruneBackupRuns`.
 */
const BACKUP_RUNS_KEEP = 5;
/**
 * Shape of a GENUINE `.lore-backups/<run>` directory name — exactly what
 * `defaultNow()` (`new Date().toISOString()`, e.g.
 * `"2026-01-08T00:00:00.000Z"`) produces, and what `install()`'s own
 * `nowIso` names every backup-run directory it creates. A directory name
 * that does NOT match this shape is foreign/user-created and is NEVER a
 * pruning candidate, regardless of how many conforming directories already
 * exceed {@link BACKUP_RUNS_KEEP} (SPEC-076 §C5 safety requirement).
 * Lexicographic sort of matching names equals chronological order for this
 * exact format (the same property `uninstall` already relies on).
 */
const RUN_DIR_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Synthetic manifest path for the `mcp` kind entry — there is no real file behind it. */
const MCP_ENTRY_PATH = "mcp:lore";
/**
 * `<targetDir>/.lore-setup-check.json` — the `lore setup --check` cache file
 * (SPEC-076 §C6, T4/`setup-check.ts`'s `SetupCheckCache` shape/lifecycle,
 * NOT owned here). This is a DELIBERATE literal duplicate of that module's
 * own `CHECK_CACHE_FILENAME` constant, same rationale as the (former)
 * `MANIFEST_FILENAME` duplication it documents: this service only needs the
 * stable on-disk FILENAME to invalidate the cache on a real converge (see
 * this module's header, "check-cache invalidation") — it has no reason to
 * import `setup-check.ts` (an adapter-layer module; services don't depend on
 * adapters), and the reverse direction (setup-check.ts importing FROM here)
 * is already used for `MANIFEST_FILENAME` above.
 */
const CHECK_CACHE_FILENAME = ".lore-setup-check.json";

const defaultNow = (): string => new Date().toISOString();

// ─── Test-pollution safety guard ────────────────────────────────────────────

/**
 * Refuses a `targetDir` that is (or is nested inside) the REAL
 * `os.homedir()/.claude` directory of the executing user, unless
 * `process.env.LORE_SETUP_ALLOW_REAL === "1"` (the production escape hatch —
 * a genuine `lore setup` run targets exactly this directory). Every
 * {@link SetupService} public method calls this first.
 *
 * @param targetDir - Candidate target directory (resolved, per this module's
 *   "targetDir is a RESOLVED string param" invariant).
 * @returns `ok(undefined)` when safe to proceed, else `err(VALIDATION_ERROR)`.
 * @throws Never.
 *
 * @example
 * assertSafeTargetDir("/tmp/some-mkdtemp-dir"); // => ok(undefined)
 * assertSafeTargetDir(`${os.homedir()}/.claude`); // => err({code: "VALIDATION_ERROR", ...})
 */
export function assertSafeTargetDir(targetDir: string): Result<void, LoreError> {
  if (process.env["LORE_SETUP_ALLOW_REAL"] === "1") return ok(undefined);

  const realClaudeDir = path.resolve(os.homedir(), ".claude");
  const resolved = path.resolve(targetDir);
  const isRealOrNested = resolved === realClaudeDir || resolved.startsWith(`${realClaudeDir}${path.sep}`);

  if (isRealOrNested) {
    return err({
      code: "VALIDATION_ERROR",
      field: "targetDir",
      message:
        `refusing to target the real "${realClaudeDir}" — this looks like a test/dev run. ` +
        `Set LORE_SETUP_ALLOW_REAL=1 to perform a genuine install against the real Claude Code config dir.`,
      value: targetDir,
    });
  }

  return ok(undefined);
}

/** Hex sha256 of a UTF-8 string — the single hashing site every `SetupEntry.sha256` in this service flows through. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ─── SetupService ────────────────────────────────────────────────────────────

/**
 * Global-machine installer service — see the module-level doc comment at the
 * top of this file for the full contract, invariants, and invariant-to-test
 * mapping (I1-I5). Four constructor-injected ports, three public methods
 * (`planInstall`/`install`/`uninstall`), zero direct `fs`/`child_process` use.
 */
export class SetupService {
  constructor(
    private readonly assetSource: AssetSource,
    private readonly reader: SetupFsReader,
    private readonly writer: SetupFsWriter,
    private readonly mcpRegistrar: McpRegistrar,
  ) {}

  /**
   * Dry-run planner — computes what `install()` WOULD do, touching only
   * `this.assetSource` and `this.reader` (never `this.writer`/`this.mcpRegistrar`
   * — invariant I4).
   *
   * @param opts - `{targetDir}` (resolved, absolute).
   * @returns The pure `InstallPlan` (`@lore/core`'s `writes`/`skips`/`backups`/`removals`).
   * @throws VALIDATION_ERROR (unsafe targetDir / malformed settings.json / malformed manifest)
   */
  async planInstall(opts: { targetDir: string }): Promise<Result<InstallPlan, LoreError>> {
    const guard = assertSafeTargetDir(opts.targetDir);
    if (!guard.ok) return guard;

    const payloadResult = await this.assetSource.load();
    if (!payloadResult.ok) return payloadResult;

    const resolvedResult = await resolvePayload(opts.targetDir, payloadResult.value, this.reader);
    if (!resolvedResult.ok) return resolvedResult;

    const manifestPath = path.join(opts.targetDir, MANIFEST_FILENAME);
    const manifestRaw = await this.reader.read(manifestPath);
    const currentResult = parseManifestRaw(manifestRaw);
    if (!currentResult.ok) return currentResult;

    const existingFilesResult = await buildExistingFilesMap(opts.targetDir, resolvedResult.value, this.reader);
    if (!existingFilesResult.ok) return existingFilesResult;

    return ok(
      computeInstallPlan(stripMcpEntries(currentResult.value), resolvedResult.value, existingFilesResult.value),
    );
  }

  /**
   * Materializes the asset payload into `targetDir`: plans the ENTIRE run
   * first (zero writer calls yet), then backs up + writes + removes via
   * `this.writer`, registers the MCP server, and — only if its content
   * actually differs from what's on disk — writes the authoritative manifest
   * LAST.
   *
   * @param opts - `{targetDir, binPath, forceDiverged?}` — `binPath` is passed
   *   straight to `McpRegistrar.add`. `forceDiverged` (SPEC-076 §C3 D2,
   *   default `false`) overrides the default-skip policy for `diverged`
   *   managed-ownership paths on the UPDATE path (an installed manifest
   *   already exists) — every diverged path is then backed up and
   *   overwritten instead of reported via `SetupReceipt.skippedDiverged`. No
   *   effect on a fresh install (D3 — no prior manifest means no "diverged"
   *   concept to override).
   * @param now - Time seam (mirrors the codebase-wide `now: () => string`
   *   convention, e.g. `DriftCheckService`/`PhaseService`) — resolved ONCE per
   *   call; also doubles as the backup-run directory key `uninstall` later
   *   derives from each entry's `written_at` (see module invariants).
   * @returns `SetupReceipt` on success (a partial one is NEVER returned — a
   *   mid-write failure is always an `err`, see below).
   * @throws VALIDATION_ERROR (unsafe targetDir / malformed settings.json /
   *   malformed manifest / computed manifest fails its own schema),
   *   STORE_ERROR (asset load failure; a writer-port call threw mid-run — the
   *   message names every path committed before the failure and confirms the
   *   manifest was NOT written; the manifest write itself failed; the
   *   `planUpdate` divergence probe threw)
   */
  async install(
    opts: { targetDir: string; binPath: string; forceDiverged?: boolean },
    now: () => string = defaultNow,
  ): Promise<Result<SetupReceipt, LoreError>> {
    const guard = assertSafeTargetDir(opts.targetDir);
    if (!guard.ok) return guard;

    const nowIso = now();

    // ── Plan the ENTIRE run before the first writer-port call ──────────────
    const payloadResult = await this.assetSource.load();
    if (!payloadResult.ok) return payloadResult;

    const resolvedResult = await resolvePayload(opts.targetDir, payloadResult.value, this.reader);
    if (!resolvedResult.ok) return resolvedResult;
    const resolvedPayload = resolvedResult.value;

    const manifestPath = path.join(opts.targetDir, MANIFEST_FILENAME);
    const manifestRaw = await this.reader.read(manifestPath);
    const currentResult = parseManifestRaw(manifestRaw);
    if (!currentResult.ok) return currentResult;
    const current = currentResult.value;

    const existingFilesResult = await buildExistingFilesMap(opts.targetDir, resolvedPayload, this.reader);
    if (!existingFilesResult.ok) return existingFilesResult;
    const existingFiles = existingFilesResult.value;

    const strippedCurrent = stripMcpEntries(current);
    const plan = computeInstallPlan(strippedCurrent, resolvedPayload, existingFiles);

    // ── SPEC-076 T5: diverged-skip overlay — UPDATE path only (D3: a fresh
    // install, current === null, has no "diverged" concept at all). See
    // `classifyManagedDivergence`'s own doc for why the digest short-circuit
    // is deliberately bypassed here.
    let writePlan: PlannedWrite[] = plan.writes;
    let backupPaths: string[] = plan.backups;
    const skippedDiverged: string[] = [];
    const divergedOnDiskSha = new Map<string, string>();

    if (strippedCurrent !== null) {
      const divergenceResult = classifyManagedDivergence(strippedCurrent, existingFiles);
      if (!divergenceResult.ok) return divergenceResult;
      const divergedPaths = new Set(divergenceResult.value.files.diverged);

      if (divergedPaths.size > 0 && opts.forceDiverged !== true) {
        const survivingWrites: PlannedWrite[] = [];
        for (const write of plan.writes) {
          if (!divergedPaths.has(write.path)) {
            survivingWrites.push(write);
            continue;
          }
          skippedDiverged.push(write.path);
          const diskSha = existingFiles.get(write.path);
          if (diskSha !== undefined) divergedOnDiskSha.set(write.path, diskSha);
        }
        writePlan = survivingWrites;
        backupPaths = plan.backups.filter((p) => !divergedPaths.has(p));
      }
    }

    // ── Write phase — the first point ANY SetupFsWriter call may occur ─────
    const committedBackups: string[] = [];
    const committedWrites: string[] = [];
    const committedRemovals: string[] = [];

    try {
      for (const backupPath of backupPaths) {
        const srcFull = path.join(opts.targetDir, backupPath);
        const backupDir = path.dirname(path.join(opts.targetDir, BACKUPS_DIRNAME, nowIso, backupPath));
        await this.writer.mkdir(backupDir);
        await this.writer.backup(srcFull, backupDir);
        committedBackups.push(backupPath);
      }

      for (const write of writePlan) {
        const fullPath = path.join(opts.targetDir, write.path);
        await this.writer.mkdir(path.dirname(fullPath));
        await this.writer.write(fullPath, write.content, write.kind === "hook" ? { executable: true } : undefined);
        committedWrites.push(write.path);
      }

      for (const removedPath of plan.removals) {
        await this.writer.remove(path.join(opts.targetDir, removedPath));
        committedRemovals.push(removedPath);
      }
    } catch (cause) {
      return err(describeWriterFailure("install", cause, { committedBackups, committedWrites, committedRemovals }));
    }

    // ── Backup hygiene (SPEC-076 §C5, T7) — best-effort, NEVER aborts the
    // install (this task's Scope-Alt: an advisory stderr line, no
    // SetupReceipt field). Runs after a successful write phase, on every
    // install call — independent of whether THIS run itself wrote/backed up
    // anything.
    try {
      await this.pruneBackupRuns(opts.targetDir);
    } catch (cause) {
      process.stderr.write(
        `lore setup install: warning — failed to prune old .lore-backups run directories: ${describeCaught(cause)}\n`,
      );
    }

    // ── MCP registration (never aborts the run — see module invariants) ────
    const previousMcpEntry = current?.entries.find((e) => e.kind === "mcp");
    const mcpResult = await this.mcpRegistrar.add(opts.binPath);
    let mcp: SetupReceipt["mcp"];
    let mcpEntry: SetupEntry | undefined;
    if (mcpResult.ok) {
      mcp = "registered";
      const shaOfBin = sha256Hex(opts.binPath);
      const writtenAt = previousMcpEntry?.sha256 === shaOfBin ? previousMcpEntry.written_at : nowIso;
      // reason: SPEC-076 D8 — the mcp entry is never emitted by an AssetSource (it has no
      // file behind it), so its ownership is stamped directly here, "managed" per
      // setup-manifest.ts's deriveOwnershipFromKind mapping for kind: "mcp".
      mcpEntry = { path: MCP_ENTRY_PATH, kind: "mcp", sha256: shaOfBin, written_at: writtenAt, ownership: "managed" };
    } else {
      mcp = "failed";
      mcpEntry = previousMcpEntry;
    }

    // ── Manifest — authoritative, written LAST, and only if it changed ─────
    const previousEntryByPath = new Map((current?.entries ?? []).map((e) => [e.path, e] as const));
    const writeByPath = new Map(writePlan.map((w) => [w.path, w] as const));
    const skippedDivergedSet = new Set(skippedDiverged);

    const fileEntries: SetupEntry[] = resolvedPayload.files.map((file) => {
      const ownershipField = file.ownership !== undefined ? { ownership: file.ownership } : {};
      const write = writeByPath.get(file.path);
      if (write !== undefined) {
        return { path: file.path, kind: file.kind, sha256: write.sha256, written_at: nowIso, ...ownershipField };
      }
      const prev = previousEntryByPath.get(file.path);
      // Plain byte-identical skip (computeInstallPlan's `plan.skips`, disk == target) —
      // unchanged from pre-T5 behavior: `file.sha256` already equals what's on disk.
      // A diverged-and-skipped path (this file's path is in `skippedDiverged`) is the ONE
      // case that must NOT use `file.sha256` (the target — would claim disk matches the
      // target when it deliberately doesn't, SPEC-076 §C3 D2) NOR the disk's own current
      // (diverged) sha either: recording the disk value would make `classifyManagedDivergence`'s
      // NEXT run see diskSha === manifestSha (both now the user's edit) and misclassify the
      // entry as merely `outdated` instead of `diverged` — silently losing the skip
      // protection after exactly one run (empirically caught by this task's own
      // `setup-converge-diverged.bun.test.ts` STATE dimension, which re-runs `--yes` a
      // second time over the same still-diverged file and expects it skipped AGAIN). The
      // manifest sha256 must therefore STAY at the previous entry's own recorded value
      // (the last content lore itself actually wrote/verified); `divergedOnDiskSha` is the
      // last-resort fallback ONLY for a path with no `prev` entry at all (an untracked,
      // foreign, already-differing file discovered on a target's FIRST update-path run —
      // no "last known lore value" exists to preserve).
      const sha256Value = skippedDivergedSet.has(file.path)
        ? (prev?.sha256 ?? divergedOnDiskSha.get(file.path) ?? file.sha256)
        : file.sha256;
      return {
        path: file.path,
        kind: file.kind,
        sha256: sha256Value,
        written_at: prev?.written_at ?? nowIso,
        ...ownershipField,
      };
    });

    // `installed_at` bumps to `nowIso` only when THIS run actually changed the file state
    // (a write or a removal) or is stamping it for the first time ever (fresh install, or
    // a legacy pre-SPEC-076 manifest migrating in place). A byte-identical re-run RETAINS
    // the previous value — bumping it unconditionally (like `binary_version`'s bare
    // constant, which is naturally stable across calls within one process and needs no
    // such guard) would make `manifestContent` differ from `manifestRaw` on EVERY run
    // regardless of real change, breaking invariant I2 ("byte-identical re-run fires ZERO
    // writer calls") — caught by this task's own regression pass against the pre-existing
    // I2 tests in `setup-service.test.ts`.
    const hasFileChangesThisRun = writePlan.length > 0 || plan.removals.length > 0;
    const installedAt = hasFileChangesThisRun || current?.installed_at === undefined ? nowIso : current.installed_at;

    const manifestEntries = mcpEntry !== undefined ? [...fileEntries, mcpEntry] : fileEntries;
    const manifest: SetupManifest = {
      version: MANIFEST_VERSION,
      claude_dir: opts.targetDir,
      entries: manifestEntries,
      // SPEC-076 §C4 — stamped on EVERY successful converge (fresh install and update
      // alike): "which binary, when" is true regardless of whether some managed files
      // were skipped this run. `binary_version` is a bare compile-time constant — already
      // stable across repeated calls within one process, no idempotency guard needed.
      binary_version: LORE_BINARY_VERSION,
      installed_at: installedAt,
      // `assets_digest` is written ONLY when this converge leaves zero diverged files
      // un-repaired — see this module's header ("manifest version fields") for why
      // stamping it unconditionally would let a later `--check`'s digest short-circuit
      // wrongly report full sync despite a known, un-repaired divergence.
      ...(skippedDiverged.length === 0 ? { assets_digest: EMBEDDED_ASSETS_MANIFEST.tree_digest } : {}),
    };

    const manifestValidation = setupManifestSchema.safeParse(manifest);
    if (!manifestValidation.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "manifest",
        message: `computed manifest failed schema validation: ${manifestValidation.error.message}`,
        value: manifest,
      });
    }

    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestChanged = manifestContent !== (manifestRaw ?? "");
    if (manifestChanged) {
      try {
        await this.writer.mkdir(path.dirname(manifestPath));
        await this.writer.write(manifestPath, manifestContent);
      } catch (cause) {
        const reason = describeCaught(cause);
        return err({
          code: "STORE_ERROR",
          message:
            `lore setup install: all ${committedWrites.length} planned asset write(s) succeeded, but writing ` +
            `the manifest at "${manifestPath}" failed: ${reason}. The install is NOT yet authoritative — re-run to retry.`,
          ...(cause instanceof Error ? { cause } : {}),
        });
      }
    }

    // ── Check-cache invalidation (SPEC-076 T5) — see module header. Only when this run
    // actually changed something (I2's "byte-identical re-run fires zero writer calls"
    // must hold even for this cleanup step); best-effort (advisory cache, fail-open).
    if (committedWrites.length > 0 || committedRemovals.length > 0 || manifestChanged) {
      try {
        await this.writer.remove(path.join(opts.targetDir, CHECK_CACHE_FILENAME));
      } catch {
        // reason: the check cache is purely advisory (SPEC-076 §C6) — a failed removal
        // (e.g. permission denied, or it never existed) does not invalidate this
        // otherwise-successful converge; a stale cache self-corrects on its own 24h TTL
        // or the next successful converge that DOES manage to remove it.
      }
    }

    return ok({
      written: fileEntries.filter((e) => writeByPath.has(e.path)),
      skipped: plan.skips.map((s) => s.path),
      backups: committedBackups,
      mcp,
      manifestPath,
      skippedDiverged,
    });
  }

  /**
   * Prunes `<targetDir>/.lore-backups/` down to the {@link BACKUP_RUNS_KEEP}
   * most recent run directories (SPEC-076 §C5, T7). Conforming candidates
   * (`RUN_DIR_NAME_RE`) are sorted lexicographically (== chronologically for
   * ISO8601) and the oldest excess ones are removed via `this.writer.remove`
   * (recursive — matches a backup-run directory's own tree). A
   * non-conforming (foreign/user-created) directory name is NEVER a
   * candidate, unconditionally. A `this.reader` without `listDir` support
   * means "pruning unsupported by this port" — a silent no-op (see
   * `SetupFsReader.listDir`'s own doc).
   *
   * @param targetDir - Resolved, absolute (same param `install` received).
   * @throws Whatever `this.reader.listDir` / `this.writer.remove` throw —
   *   this method adds no swallowing of its own; `install`'s call site is
   *   responsible for degrading a thrown failure here to an advisory stderr
   *   warning without aborting the run (this task's own Scope-Alt: "prune
   *   warning channel = stderr line, no receipt section").
   */
  private async pruneBackupRuns(targetDir: string): Promise<void> {
    if (this.reader.listDir === undefined) return;

    const backupsDir = path.join(targetDir, BACKUPS_DIRNAME);
    const entries = await this.reader.listDir(backupsDir);
    const runDirNames = entries
      .filter((e) => e.isDirectory && RUN_DIR_NAME_RE.test(e.name))
      .map((e) => e.name)
      .sort();

    if (runDirNames.length <= BACKUP_RUNS_KEEP) return;

    const toRemove = runDirNames.slice(0, runDirNames.length - BACKUP_RUNS_KEEP);
    for (const name of toRemove) {
      await this.writer.remove(path.join(backupsDir, name));
    }
  }

  /**
   * Reverses a prior `install()` STRICTLY via the manifest — no other source
   * of truth is consulted. See module invariants for the backup-lookup
   * derivation (`entry.written_at` as the backup-run directory key) and the
   * manifest-deleted-last ordering.
   *
   * @param opts - `{targetDir}`.
   * @param _now - Time seam (unused directly by uninstall's own logic today —
   *   accepted for signature symmetry with `install` and future extension;
   *   documented rather than silently dropped).
   * @returns `SetupReceipt` (see per-field uninstall semantics on
   *   {@link SetupReceipt}).
   * @throws VALIDATION_ERROR (unsafe targetDir; no manifest found — nothing to
   *   uninstall; malformed manifest), STORE_ERROR (a writer-port call threw
   *   mid-run, before the manifest was reached; the final manifest-delete call
   *   itself threw)
   */
  async uninstall(
    opts: { targetDir: string },
    _now: () => string = defaultNow,
  ): Promise<Result<SetupReceipt, LoreError>> {
    const guard = assertSafeTargetDir(opts.targetDir);
    if (!guard.ok) return guard;

    const manifestPath = path.join(opts.targetDir, MANIFEST_FILENAME);
    const manifestRaw = await this.reader.read(manifestPath);
    if (manifestRaw === null) {
      return err({
        code: "VALIDATION_ERROR",
        field: "manifest",
        message: `no setup manifest found at "${manifestPath}" — nothing to uninstall`,
        value: manifestPath,
      });
    }

    const currentResult = parseManifestRaw(manifestRaw);
    if (!currentResult.ok) return currentResult;
    // manifestRaw !== null guarantees parseManifestRaw attempted a real parse, never the null->null shortcut.
    const current = currentResult.value as SetupManifest;

    const restoredPaths: string[] = [];
    const removedPaths: string[] = [];

    try {
      for (const entry of current.entries) {
        if (entry.kind === "mcp") continue; // handled separately below — no file behind this entry
        const fullPath = path.join(opts.targetDir, entry.path);
        const backupPath = path.join(opts.targetDir, BACKUPS_DIRNAME, entry.written_at, entry.path);
        const backupStat = await this.reader.stat(backupPath);

        if (backupStat.exists) {
          const backupContent = await this.reader.read(backupPath);
          if (backupContent === null) {
            throw new Error(`backup at "${backupPath}" reported exists but could not be read`);
          }
          await this.writer.mkdir(path.dirname(fullPath));
          await this.writer.write(fullPath, backupContent);
          restoredPaths.push(entry.path);
        } else {
          await this.writer.remove(fullPath);
          removedPaths.push(entry.path);
        }
      }

      await this.writer.remove(path.join(opts.targetDir, BACKUPS_DIRNAME));

      // AC-046-F: prune now-empty directories our removed entries leave behind — see
      // module doc's uninstall bullet for the ancestor-derivation + empty-only contract.
      for (const dir of computeAncestorDirsDeepestFirst(opts.targetDir, removedPaths)) {
        await this.writer.removeDirIfEmpty(dir);
      }
    } catch (cause) {
      return err(describeWriterFailure("uninstall", cause, { restoredPaths, removedPaths }));
    }

    const mcpEntry = current.entries.find((e) => e.kind === "mcp");
    let mcp: SetupReceipt["mcp"];
    if (mcpEntry === undefined) {
      mcp = "skipped";
    } else {
      const mcpResult = await this.mcpRegistrar.remove();
      mcp = mcpResult.ok ? "registered" : "failed";
    }

    try {
      await this.writer.remove(manifestPath);
    } catch (cause) {
      const reason = describeCaught(cause);
      return err({
        code: "STORE_ERROR",
        message:
          `lore setup uninstall: file/mcp reversal completed, but removing the manifest at "${manifestPath}" ` +
          `failed: ${reason}. Re-run --uninstall to retry manifest removal.`,
        ...(cause instanceof Error ? { cause } : {}),
      });
    }

    return ok({
      written: [],
      skipped: removedPaths,
      backups: restoredPaths,
      mcp,
      manifestPath,
      skippedDiverged: [],
    });
  }
}

// ─── Module-scope Helpers ────────────────────────────────────────────────────

/** Renders any thrown value as a diagnostic string (never re-throws). Mirrors `drift-check-service.ts`'s `describeCaught`. */
function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Builds the `STORE_ERROR` for a mid-run writer-port throw, naming exactly what committed before the failure. */
function describeWriterFailure(
  phase: "install" | "uninstall",
  cause: unknown,
  committed: Record<string, string[]>,
): LoreError {
  const reason = describeCaught(cause);
  const parts = Object.entries(committed)
    .map(([label, paths]) => `${label}: [${paths.join(", ")}]`)
    .join("; ");
  return {
    code: "STORE_ERROR",
    message:
      `lore setup ${phase} aborted mid-run: ${reason}. Committed before failure — ${parts}. ` +
      `The manifest was NOT ${phase === "install" ? "written" : "removed"} — this run's changes are NOT yet authoritative.`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

/**
 * Derives every ANCESTOR directory (up to but EXCLUDING `targetDir`) of each
 * `removedPaths` entry (repo-relative, POSIX-joined per `SetupEntry.path`),
 * deduped, sorted DEEPEST-FIRST (most path segments first) so a leaf
 * directory is always swept before its parent — letting a parent directory
 * that only contained now-removed subdirectories become empty and removable
 * in the SAME `uninstall` pass. `SetupService.uninstall`'s sole caller; see
 * the module doc's uninstall bullet for the "known simplification" this
 * cleanup pass documents (no directory-provenance tracking — a pre-existing
 * user directory that becomes empty solely because our files were removed
 * from it is pruned identically to one this install created).
 */
function computeAncestorDirsDeepestFirst(targetDir: string, removedPaths: string[]): string[] {
  const dirs = new Set<string>();
  for (const relPath of removedPaths) {
    let dir = path.dirname(relPath);
    while (dir !== "." && dir !== path.sep) {
      dirs.add(path.join(targetDir, dir));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return [...dirs].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

/**
 * Placeholder token a `kind: "settings-hook"` asset's entry `command` strings
 * may carry in place of the real target dir (emitted by `RealAssetSource`,
 * which has no knowledge of the eventual install target — see
 * `@lore/core`'s `distribution-hooks.ts` doc comment). Substituted for the
 * real `targetDir` HERE, after JSON-parsing and BEFORE `mergeSettings` — so
 * the merged `command` strings (`mergeSettings`' identity key) are stable
 * across install/uninstall for a given `targetDir`.
 */
const CLAUDE_DIR_PLACEHOLDER = "{{CLAUDE_DIR}}";

/** Replaces every occurrence of {@link CLAUDE_DIR_PLACEHOLDER} in `command` with `targetDir`. A no-op when the placeholder is absent. */
function resolveClaudeDirPlaceholder(command: string, targetDir: string): string {
  return command.split(CLAUDE_DIR_PLACEHOLDER).join(targetDir);
}

/**
 * Resolves the FINAL content + sha256 for every payload file: a `kind:
 * "settings-hook"` entry's `content` is parsed as `SettingsHookEntry[]`,
 * each entry's `command` has {@link CLAUDE_DIR_PLACEHOLDER} substituted for
 * the real `targetDir`, and the result is merged (via `@lore/core`'s
 * `mergeSettings`) against the target's ON-DISK `settings.json` (read
 * through `reader`); every other kind's `content` is used verbatim. `sha256`
 * is ALWAYS recomputed here over the resulting content (invariant I5) — the
 * raw `AssetPayload`'s own `sha256` field is never trusted.
 */
async function resolvePayload(
  targetDir: string,
  payload: AssetPayload,
  reader: SetupFsReader,
): Promise<Result<AssetPayload, LoreError>> {
  const resolvedFiles: AssetFile[] = [];

  for (const file of payload.files) {
    if (file.kind === "settings-hook") {
      let loreEntries: SettingsHookEntry[];
      try {
        loreEntries = JSON.parse(file.content) as SettingsHookEntry[];
      } catch (cause) {
        return err({
          code: "VALIDATION_ERROR",
          field: `asset:${file.path}`,
          message: `settings-hook asset "${file.path}" content is not a valid JSON hook-entry array: ${describeCaught(cause)}`,
          value: file.content.slice(0, 200),
        });
      }

      loreEntries = loreEntries.map((entry) => ({
        ...entry,
        command: resolveClaudeDirPlaceholder(entry.command, targetDir),
      }));

      const existingRaw = await reader.read(path.join(targetDir, file.path));
      // SPEC-076 §C5 (T7): enable orphan pruning — `hooksPathPrefix` mirrors
      // `distribution-hooks.ts::buildHookSettingsEntries`'s OWN literal
      // `${claudeDir}/hooks/` concatenation (never `path.join`, no OS
      // separator translation — command strings are plain
      // `"<runner> <path>"` shell text, not filesystem paths this process
      // resolves; a trailing `/` on `targetDir` is stripped the same way
      // that function tolerates one, so both `"/x/.claude"` and
      // `"/x/.claude/"` compute an identical, double-slash-free prefix).
      // `mergeSettings` matches via a whitespace-token `startsWith` check
      // (`commandReferencesHooksPath`, path-boundary, never a raw substring
      // test) specifically because a real command is prefixed with a runner
      // (`"node "`/`"bash "`), never a bare path — the runner-prefixed path
      // token itself still starts with `hooksPathPrefix` — see that module's
      // own doc.
      const trimmedTargetDir = targetDir.endsWith("/") ? targetDir.slice(0, -1) : targetDir;
      const hooksPathPrefix = `${trimmedTargetDir}/hooks/`;
      const mergeResult = mergeSettings({ existingRaw, loreEntries, hooksPathPrefix });
      if (!mergeResult.ok) return mergeResult;

      const mergedContent = `${JSON.stringify(mergeResult.value.merged, null, 2)}\n`;
      resolvedFiles.push({
        path: file.path,
        kind: file.kind,
        content: mergedContent,
        sha256: sha256Hex(mergedContent),
        // reason: SPEC-076 T5 — this object is built fresh (not `...file`) because
        // `content`/`sha256` MUST be the post-merge values, so `ownership` (declared by
        // the AssetSource, e.g. RealAssetSource's "merged" for settings-hook) must be
        // carried through explicitly too, or a settings-hook entry would silently lose
        // its ownership zone on every resolvePayload call.
        ...(file.ownership !== undefined ? { ownership: file.ownership } : {}),
      });
      continue;
    }

    resolvedFiles.push({ ...file, sha256: sha256Hex(file.content) });
  }

  return ok({ files: resolvedFiles });
}

/**
 * Strips the synthetic `kind: "mcp"` manifest entry (if any) before handing a
 * manifest to `@lore/core`'s `computeInstallPlan`. That pure function's
 * `removals` computation is "tracked in `current` but absent from `payload`" —
 * the mcp entry is ALWAYS absent from `AssetPayload.files` (it isn't a file at
 * all), so passing it through unfiltered would make every install() run
 * spuriously call `writer.remove("mcp:lore")`, breaking invariant I2 (a
 * byte-identical re-run must fire ZERO writer calls). The mcp entry's own
 * lifecycle is handled entirely separately, in `install`/`uninstall`.
 */
function stripMcpEntries(manifest: SetupManifest | null): SetupManifest | null {
  if (manifest === null) return null;
  return { ...manifest, entries: manifest.entries.filter((e) => e.kind !== "mcp") };
}

/**
 * The machine-installer-relevant view of the compiled binary's embedded
 * asset manifest — `kind: "project"` entries excluded (mirrors
 * `../adapters/cli/setup-check.ts`'s own `buildCheckEmbeddedManifest`; that
 * module's doc explains why `assets/project/` is out of scope for the
 * global machine installer). `tree_digest` is carried through UNCHANGED
 * (still the whole-tree value, project entries included) — this function's
 * caller ({@link classifyManagedDivergence}) never reads it (see that
 * function's own "deliberately bypasses the digest short-circuit" doc).
 */
function buildManagedEmbeddedManifest(): { binary_version: string; tree_digest: string; entries: readonly (typeof EMBEDDED_ASSETS_MANIFEST.entries)[number][] } {
  return {
    binary_version: LORE_BINARY_VERSION,
    tree_digest: EMBEDDED_ASSETS_MANIFEST.tree_digest,
    entries: EMBEDDED_ASSETS_MANIFEST.entries.filter((entry) => entry.kind !== "project"),
  };
}

/**
 * Classifies every managed (non-project) embedded asset path's on-disk
 * freshness via `@lore/core`'s pure five-state `planUpdate`, using the
 * already-probed `existingFiles` map (`buildExistingFilesMap`'s output —
 * paid for regardless, by `computeInstallPlan`'s own needs) as the
 * `UpdateProbe`'s per-path answer. `install()`'s ONLY consumer of this
 * result is `files.diverged` — deciding which of `computeInstallPlan`'s
 * writes must be skipped-by-default (SPEC-076 §C3 D2).
 *
 * @invariant Deliberately STRIPS `assets_digest` from the `installed`
 *   manifest handed to `planUpdate`, even though the REAL on-disk manifest
 *   may already carry one (stamped by THIS service's own prior successful
 *   converge — see this module's header, "manifest version fields").
 *   `planUpdate`'s digest-equality short-circuit exists to let
 *   `lore setup --check` (T4, a separate, read-only projection) skip a
 *   fresh 292-path probe when nothing has changed at the BUILD level — but
 *   `install()` has ALREADY paid the cost of probing every path (via
 *   `buildExistingFilesMap`, unconditionally required by
 *   `computeInstallPlan` regardless of this call), so the short-circuit buys
 *   this call zero performance while silently defeating the very divergence
 *   detection this run exists to perform: a converge whose OWN prior run
 *   stamped a matching `assets_digest` must never trust that value for its
 *   OWN next-run write decision, or a user-edited managed file would go
 *   right on being silently overwritten forever (the exact bug SPEC-076 D2
 *   exists to fix) as long as the binary/build never changes.
 * @invariant `listManagedPaths()` (orphan discovery) always returns `[]` —
 *   `SetupFsReader` (this service's read port) has no directory-enumeration
 *   member, and extending it would touch `real-setup-fs.ts`, outside this
 *   task's claimed anchors. `install()`'s converge decision never consults
 *   `files.orphaned` (SPEC-076 §C3: orphaned entries are report-only and
 *   never actioned by ANY command) — full orphan discovery for human/CI
 *   consumption remains `lore setup --check`'s dedicated job (T4's
 *   `RealSetupCheckProbe`, which DOES walk the managed directories).
 */
function classifyManagedDivergence(
  installed: SetupManifest,
  existingFiles: Map<string, string>,
): Result<UpdatePlan, LoreError> {
  const embedded = buildManagedEmbeddedManifest();
  const installedForClassification: SetupManifest = { ...installed, assets_digest: undefined };
  const probe: UpdateProbe = {
    resolve(relPath: string): { sha256: string } | "missing" {
      const sha = existingFiles.get(relPath);
      return sha !== undefined ? { sha256: sha } : "missing";
    },
    listManagedPaths(): string[] {
      return [];
    },
  };
  return planUpdate(embedded, installedForClassification, probe);
}

/**
 * Parses+validates a manifest raw string (or the "no manifest yet" `null`
 * shortcut) into `SetupManifest | null`. Shared by `planInstall`/`install`
 * (where `null` on-disk means "first-ever install") and re-derived
 * independently by `uninstall` (which has already ruled out `null` by that
 * point, but reuses this for the malformed-JSON/schema-violation path).
 */
function parseManifestRaw(manifestRaw: string | null): Result<SetupManifest | null, LoreError> {
  if (manifestRaw === null) return ok(null);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(manifestRaw);
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `existing setup manifest is not valid JSON: ${describeCaught(cause)}`,
      value: manifestRaw.slice(0, 200),
    });
  }

  const parsed = setupManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `existing setup manifest failed schema validation: ${parsed.error.message}`,
      value: parsedJson,
    });
  }

  return ok(parsed.data);
}

/**
 * Builds the `path → on-disk sha256` map `@lore/core`'s pure `planInstall`
 * needs, via `reader.stat` — one call per resolved payload file. A path
 * reported `exists: true` with no `sha256` is a `SetupFsReader` contract
 * violation; this fails loud rather than guessing (guessing "not on disk"
 * would silently skip backing up a REAL file before overwriting it).
 */
async function buildExistingFilesMap(
  targetDir: string,
  payload: AssetPayload,
  reader: SetupFsReader,
): Promise<Result<Map<string, string>, LoreError>> {
  const existingFiles = new Map<string, string>();

  for (const file of payload.files) {
    const statResult = await reader.stat(path.join(targetDir, file.path));
    if (!statResult.exists) continue;
    if (statResult.sha256 === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: `stat:${file.path}`,
        message: `SetupFsReader.stat reported exists:true for "${file.path}" with no sha256 — contract violation`,
        value: statResult,
      });
    }
    existingFiles.set(file.path, statResult.sha256);
  }

  return ok(existingFiles);
}
