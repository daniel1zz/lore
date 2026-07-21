/**
 * Per-repo project scaffold flow behind `lore setup --project` (SPEC-046
 * §Design, §Scope — "lore setup --project: lore init (existing service path)
 * + assets/project/ hooks + pre-push + lore.tree.yaml + git config
 * core.hooksPath hooks — via ProjectSetupService + flows/setup-project-flow.ts").
 * This is the repo-TARGET half of the SPEC-046 installer — a SEPARATE concern
 * from `service/setup-service.ts`'s machine-target (`~/.claude`) install, and
 * this file MUST NOT import anything from `adapters/cli/commands/*` (flows are
 * shared derivation consumed BY commands, never the reverse — the
 * `blueprint-flow.ts`/`drift-flow.ts` precedent).
 *
 * **SPEC-060 D1 — repo-level install ledger.** This flow now tracks every
 * `hooks/*` and `lore.tree.yaml` path it writes into a repo-local manifest at
 * `.lore/.lore-project-manifest.json`, reusing `@lore/core`'s `planInstall`/
 * `setupManifestSchema` pure primitives UNCHANGED (they are `targetDir`-
 * agnostic — see that module's own doc comment). The manifest is written LAST,
 * only when its computed content differs from what's on disk, mirroring
 * `SetupService.install`'s plan → backup → write → manifest-last sequence —
 * see `runManifestWriteSeam` below for the full contract.
 *
 * Public surface:
 *   ProjectFsPort        — the narrow fs port (exists/readFile/writeFile/mkdir
 *                           + OPTIONAL backup/remove, SPEC-060 D1/D2)
 *   ExecPort              — the narrow process-exec port (used for `git config`)
 *   InitCorpus            — the `.lore/` bootstrap thunk, PROVIDED BY THE ADAPTER
 *                           (wraps the same logic `commands/init.ts` runs — never
 *                           imported directly here, so this module never
 *                           constructs a `CorpusService`/`App` itself)
 *   ProjectAssetSource    — reads one named `assets/project/*` file by filename
 *   ProjectScaffoldFlowDeps — the four ports above, bundled
 *   ProjectScaffoldOptions  — `{ repoDir }`, the per-call target repo
 *   ProjectScaffoldReport   — the full per-step outcome report (now carries
 *                           `manifest`/`backups`, SPEC-060 D1)
 *   scaffoldProject(deps, opts, now?) — runs all four steps plus the manifest
 *     write seam, always returns `ok` with a report UNLESS `opts.repoDir`
 *     itself is malformed (top-level `err`)
 *
 * Invariants:
 *   - NARROW injected deps, never the full `App` (mirrors `StalenessFlowDeps`/
 *     `DriftFlowDeps`) — keeps this module vitest-testable with plain fakes and
 *     free of any `bun:sqlite`-reaching import.
 *   - Each of the four steps — and each per-file operation WITHIN the hooks
 *     step — is wrapped in its own try/catch. A thrown IO error becomes a
 *     `failed` step/file result; it NEVER aborts the remaining steps or the
 *     remaining hook files (mirrors `DriftCheckService`'s per-probe isolation,
 *     SPEC-045 D4 — a batch-abort would silently under-report an otherwise
 *     scaffoldable repo). **SPEC-060**: the manifest write seam preserves this
 *     per-file isolation too (a per-path try/catch around each backup/write/
 *     removal), a DELIBERATE divergence from `SetupService.install`'s single
 *     wrapping try/catch (which aborts its whole write phase on the first
 *     failure) — that machine-installer behavior would break this module's
 *     own pre-existing "one file's failure never blocks its siblings" contract.
 *   - Idempotent by design: a target already carrying the exact shipped bytes
 *     is `skipped`, never rewritten; a `.lore/` directory that already exists
 *     short-circuits `initCorpus` entirely (it is never called on a re-run).
 *   - Conflict, not clobber: a hooks/* file that exists with DIFFERENT content
 *     than the shipped asset is reported `conflict` and left byte-for-byte
 *     untouched — repo hooks may be user-customized (SPEC-046 §Design). This
 *     conflict check applies ONLY to the hooks step; `lore.tree.yaml` uses the
 *     simpler "present → skipped" rule the spec literally describes (no
 *     content diff), since a project's tree blueprint is expected to diverge
 *     from the template immediately after first scaffold. **SPEC-060**: EITHER
 *     case (hooks-conflict, or a present-but-differing `lore.tree.yaml`) is
 *     also excluded from the manifest ledger going forward — lore stops
 *     claiming a path the moment it observes divergent content, so a re-run
 *     never backs up or deletes what is now understood to be user-owned. A
 *     PREVIOUSLY lore-tracked path that later diverges this way is silently
 *     DROPPED from the manifest on the next run (never removed from disk,
 *     never overwritten) — see `runManifestWriteSeam`.
 *   - `scaffoldProject` itself never throws and never rejects — every
 *     failure mode surfaces as either a step-level `"failed"`/`"conflict"`
 *     status inside the returned report, or (for a malformed `repoDir` only)
 *     a top-level `err(VALIDATION_ERROR)`.
 *   - **SPEC-060**: `ProjectFsPort.backup`/`.remove` are OPTIONAL (unlike the
 *     machine installer's `SetupFsWriter`, whose surface they otherwise
 *     mirror) — a deliberate, additive-only extension (same convention as
 *     `@lore/core`'s `AssetFile.executable?`/`attestation.first_seen?`) so
 *     pre-existing `ProjectFsPort` implementations (`commands/setup.ts`'s
 *     `makeRealProjectFs`, `project-setup-service.test.ts`'s `makeRealFs`,
 *     neither of which this task's anchors permit editing) keep typechecking
 *     unchanged. A port that omits `backup`/`remove` simply cannot satisfy a
 *     write the ledger determines needs one — that surfaces as a LOUD,
 *     per-path `"failed"` result (see `runManifestWriteSeam`), never a silent
 *     skip-the-backup-and-overwrite. Neither of THIS module's own two
 *     ledger-tracked steps (hooks/tree_yaml) ever exercises the backup path
 *     today (see the conflict bullet above) — it exists for a future step
 *     with true backup-then-overwrite semantics (SPEC-060 D4, CLAUDE.md).
 *
 * Side-effect class: IO (delegates entirely to the injected ports)
 * Source: SPEC-046 §Design, §Scope; task AC-046-C. SPEC-060 §Design, D1.
 */

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { err, ok, planInstall, setupManifestSchema } from "@lore/core";
import type { AssetFile, LoreError, Result, SetupEntry, SetupEntryKind, SetupManifest } from "@lore/core";

// ─── Ports (constructed by the adapter, injected here) ─────────────────────

/**
 * Narrow filesystem port — the ONLY way this flow touches disk. A real
 * implementation (node:fs-backed) is built by the CLI adapter (a SEPARATE
 * task, AC-046-E); this module never imports node:fs directly.
 *
 * @invariant None of these methods may throw for `exists`/`readFile` (a
 *   missing/unreadable path is a normal, expected outcome — `false`/`null`).
 *   `writeFile`/`mkdir` MAY throw on a genuine IO failure (permission denied,
 *   disk full, ...) — callers in this module catch per-step/per-file.
 */
export interface ProjectFsPort {
  /** True if `path` exists (file OR directory). Never throws. */
  exists(path: string): boolean;
  /** Reads `path` as a utf-8 string. Returns `null` when missing/unreadable. Never throws. */
  readFile(path: string): string | null;
  /** Writes `content` to `path`, creating/overwriting it, with POSIX mode `mode`. MAY throw. */
  writeFile(path: string, content: string, mode: number): void;
  /** Creates `path` as a directory, recursively, idempotently. MAY throw. */
  mkdir(path: string): void;
  /**
   * OPTIONAL (SPEC-060 D1/D2) — copies the file currently at `src`'s CURRENT
   * bytes into `destDir` (same basename), preserving its bytes, before the
   * manifest write seam overwrites `src` with different content. Mirrors
   * `SetupFsWriter.backup`'s surface — but is OPTIONAL here, see this
   * module's top-level doc comment for why. MAY throw on a genuine IO
   * failure (a missing `src` is a caller-side bug, not a port contract this
   * method needs to tolerate — `runManifestWriteSeam` only ever calls this
   * for a path it already confirmed exists).
   */
  backup?(src: string, destDir: string): void;
  /**
   * OPTIONAL (SPEC-060 D1/D2) — removes the file or directory (recursively)
   * at `path`. A missing target is a no-op. Same additive-capability
   * rationale as {@link backup}. MAY throw on a genuine IO failure.
   */
  remove?(path: string): void;
}

/**
 * Narrow process-exec port — used solely for the `git config core.hooksPath`
 * step. A real implementation (node:child_process-backed) is built by the CLI
 * adapter (AC-046-E).
 *
 * @invariant Never throws or rejects — a spawn failure (binary missing,
 *   ENOENT, ...) surfaces as a resolved result with a nonzero synthetic `code`
 *   and a populated `stderr`, never a thrown exception.
 */
export interface ExecPort {
  /** Runs `argv` with cwd `cwd`; resolves with the exit code and captured output. */
  run(argv: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

/**
 * The `.lore/` bootstrap thunk — wraps the SAME logic `commands/init.ts` runs
 * (directory creation, `.gitignore`, `config.yaml` via `saveConfig`, DB
 * migration) behind one function so this flow never constructs a
 * `CorpusService`/`App` itself and never imports a sibling `commands/*` file
 * (command→command imports are forbidden — SPEC-046 task boundary note). The
 * CLI adapter (AC-046-E) is the ONLY place that builds the real thunk.
 *
 * @param repoDir - Absolute path to the target repo root to initialize.
 * @returns `ok(undefined)` on success, `err` on any init failure.
 */
export type InitCorpus = (repoDir: string) => Promise<Result<void, LoreError>>;

/**
 * Reads one named file out of the `assets/project/` SSOT tree by its bare
 * filename (e.g. `"g1-spec-create.sh"`, `"lore.tree.yaml.template"`) — never
 * a hardcoded absolute repo path; repo-root-relative resolution is injected
 * by the adapter (mirrors `FsProbe`'s "real impl built in the adapter"
 * placement). Deliberately simpler than the global installer's `AssetSource`
 * (which loads a whole `AssetPayload` keyed by target-relative paths) — this
 * flow only ever needs single named lookups within one fixed asset directory.
 */
export interface ProjectAssetSource {
  /** Reads asset `name`'s content. `err(VALIDATION_ERROR)` for an unknown/unreadable name — never throws. */
  readAsset(name: string): Promise<Result<string, LoreError>>;
}

/** The four ports {@link scaffoldProject} depends on, bundled for constructor injection. */
export interface ProjectScaffoldFlowDeps {
  fs: ProjectFsPort;
  exec: ExecPort;
  initCorpus: InitCorpus;
  assets: ProjectAssetSource;
}

/** Per-call scaffold target — kept a distinct parameter (not constructor-bound), mirroring `SetupService.targetDir`. */
export interface ProjectScaffoldOptions {
  /** Absolute path to the target git repository root. */
  repoDir: string;
}

// ─── Report shapes ──────────────────────────────────────────────────────────

/** Outcome of a step with no "existing-but-different" case (init, tree.yaml). */
export type SimpleStepStatus = "done" | "skipped" | "failed";

/** One non-hooks step's outcome. */
export interface SimpleStepResult {
  status: SimpleStepStatus;
  /** Human-readable detail — a path on success, an error message on failure. */
  detail?: string;
}

/** Outcome of copying one hooks/* file — the only step with a "conflict" outcome. */
export type HookFileStatus = "done" | "skipped" | "failed" | "conflict";

/** One hooks/* file's copy outcome. */
export interface HookFileResult {
  /** Repo-relative target path, e.g. `"hooks/g1-spec-create.sh"`. */
  file: string;
  status: HookFileStatus;
  /** Human-readable detail — populated for `"conflict"`/`"failed"`. */
  detail?: string;
}

/** The `git config core.hooksPath hooks` step's outcome, plus the prior value for the receipt. */
export interface GitHooksPathResult {
  status: SimpleStepStatus;
  /** The value `core.hooksPath` held BEFORE this run, or `null` if unset/unreadable. */
  prior_value: string | null;
  detail?: string;
}

/** The full per-step outcome of one {@link scaffoldProject} run. */
export interface ProjectScaffoldReport {
  init: SimpleStepResult;
  hooks: HookFileResult[];
  tree_yaml: SimpleStepResult;
  git_hooks_path: GitHooksPathResult;
  /**
   * SPEC-060 D1 — outcome of writing `.lore/.lore-project-manifest.json`
   * itself (the ledger file), LAST, after every tracked write/backup/removal
   * has been attempted. `"skipped"` means the computed manifest content was
   * already byte-identical to what's on disk (I2-style idempotency).
   */
  manifest: SimpleStepResult;
  /**
   * SPEC-060 D1/D6 — repo-relative paths backed up (into
   * `.lore/.lore-backups/<iso>/`) before being overwritten this run. Always
   * `[]` for THIS task's own two ledger-tracked steps (hooks/tree_yaml never
   * overwrite differing content — see module doc) — populated once a future
   * step with true backup-then-overwrite semantics lands (SPEC-060 D4).
   */
  backups: string[];
}

// ─── Asset/target name tables ───────────────────────────────────────────────

/** The `assets/project/*` hook filenames copied verbatim into `<repo>/hooks/`. */
const HOOK_ASSET_NAMES = [
  "g1-spec-create.sh",
  "g2-spec-promote.sh",
  "g3-plan-promote.sh",
  "g4-task-claim.sh",
  "pre-push",
] as const;

/** Hook scripts must remain executable after copy (SPEC-046 §Design "execute bits preserved"). */
const HOOK_FILE_MODE = 0o755;

const TREE_TEMPLATE_ASSET_NAME = "lore.tree.yaml.template";
const TREE_TEMPLATE_TARGET_NAME = "lore.tree.yaml";
const TREE_YAML_MODE = 0o644;

// ─── SPEC-060 D1 — repo-level install ledger constants ─────────────────────

/** Repo-relative path to the ledger this flow maintains (mirrors `SetupService`'s `.lore-setup-manifest.json`, one directory tier down). */
const PROJECT_MANIFEST_RELATIVE_PATH = ".lore/.lore-project-manifest.json";
/** Repo-relative directory backups land under, one `<iso>` subdirectory per write-seam run that performed at least one backup. */
const PROJECT_BACKUPS_RELATIVE_DIRNAME = ".lore/.lore-backups";
/** Ledger schema version — opaque string, bumped only on a breaking shape change (mirrors `SetupService.MANIFEST_VERSION`). */
const PROJECT_MANIFEST_VERSION = "1";

/**
 * The `SETUP_ENTRY_KINDS` enum member used for project-scaffold assets that
 * aren't `hooks/*` scripts (currently only `lore.tree.yaml`). SPEC-060 D1
 * reuses `@lore/core`'s machine-installer manifest schema UNCHANGED (per the
 * spec's explicit instruction) — its `kind` enum was designed for the
 * machine installer's own asset taxonomy (skill/agent/hook/governance/
 * settings-hook/mcp) and has no member that names "repo scaffold config".
 * `"governance"` is the closest existing fit (a repo-level configuration
 * artifact — the same rough category as the machine installer's own
 * `governance/corpus-workflow.md`). Chosen over widening `SETUP_ENTRY_KINDS`
 * itself because that enum backs an exhaustive `Record<..., string>` in
 * `adapters/cli/setup-render.ts` (a SIBLING task's file anchor, off-limits
 * here) — adding a member would force an edit there. A future step with true
 * backup-then-overwrite semantics (SPEC-060 D4, `CLAUDE.md.template`) should
 * reuse this SAME constant for consistency, unless a later task explicitly
 * revisits the kind taxonomy.
 */
const PROJECT_ASSET_KIND: SetupEntryKind = "governance";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Renders a thrown value's message for a step's `detail` field. Never throws. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Renders a `LoreError` for a step's `detail` field. Never throws. */
function describeError(error: LoreError): string {
  return JSON.stringify(error);
}

/** Hex sha256 of a UTF-8 string — the single hashing site every ledger `SetupEntry.sha256` in this module flows through. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const defaultNow = (): string => new Date().toISOString();

// ─── SPEC-060 D1 — manifest read/write seam ─────────────────────────────────

/**
 * Reads and validates the on-disk project manifest. NEVER throws and NEVER
 * surfaces a parse/schema failure to the caller as an error — a missing,
 * corrupted, or schema-invalid manifest is uniformly treated as `null`
 * ("no ledger yet", i.e. a fresh install for every currently-tracked path).
 *
 * This is a DELIBERATE divergence from `SetupService.install`'s fail-loud
 * `VALIDATION_ERROR` on a malformed machine-installer manifest: this module's
 * own pre-existing, already-documented invariant is that `scaffoldProject`
 * NEVER fails the whole run over a single step's local trouble (see module
 * doc) — a corrupted ledger file is exactly that kind of local trouble. The
 * run proceeds and simply overwrites the ledger with a freshly-computed,
 * valid one; no user data is at risk either way (the ledger is metadata, not
 * the tracked files themselves — see also the module doc's conflict bullet:
 * this function is only ever consulted to decide *ledger entries*, and a
 * miscomputed `null` here still can never SKIP the hooks/tree_yaml steps'
 * own already-safe conflict logic upstream).
 */
function readProjectManifest(deps: ProjectScaffoldFlowDeps, repoDir: string): SetupManifest | null {
  const raw = deps.fs.readFile(join(repoDir, PROJECT_MANIFEST_RELATIVE_PATH));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = setupManifestSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

/** The manifest write seam's outcome — folded into {@link ProjectScaffoldReport}'s `manifest`/`backups` fields by {@link scaffoldProject}. */
interface ManifestSeamResult {
  /** Repo-relative path → error message, for any candidate whose backup or write attempt threw. */
  failed: Map<string, string>;
  /** Repo-relative paths successfully backed up before an overwrite, this run. */
  backups: string[];
  /** Outcome of writing the ledger file itself, last. */
  manifestStatus: SimpleStepResult;
}

/**
 * The SPEC-060 D1 manifest-aware write seam — the "one plannedWrite
 * collector" the spec's §Design describes. Runs `@lore/core`'s pure
 * `planInstall` over the caller-supplied `candidates` (every file THIS run's
 * steps determined is either missing or already byte-identical on disk — a
 * step with "conflict"/"differs, leave alone" semantics for a given path
 * MUST exclude that path from `candidates` BEFORE calling this function; see
 * `runHooksStep`/`runTreeYamlStep`), then executes the resulting plan
 * (backup → write → remove) via `deps.fs`, and finally writes the ledger file
 * itself — LAST, and only if its computed content differs from what's on
 * disk (mirrors `SetupService.install`'s manifest-last / I2 idempotency
 * discipline).
 *
 * `managedPaths` is the FULL set of repo-relative paths the calling step(s)
 * are responsible for, REGARDLESS of whether each is present in `candidates`
 * this run — this is what lets a path that was previously ledger-tracked but
 * has now diverged (excluded from `candidates` by the caller) be silently
 * DROPPED from the ledger rather than miscounted as "no longer declared at
 * all" and queued for `deps.fs.remove` (a `path` outside `managedPaths`
 * entirely — e.g. one a FUTURE co-located step owns — is left untouched in
 * either direction, so multiple steps can safely share one ledger file).
 *
 * @invariant Per-path fault isolation — EVERY backup/write/removal attempt is
 *   wrapped in its OWN try/catch; one path's failure never blocks another's
 *   (see module doc's per-file-isolation bullet). A candidate whose backup or
 *   write failed is EXCLUDED from the computed manifest (never falsely
 *   claimed as lore-managed).
 * @invariant A `plan.backups`/`plan.removals` entry with no corresponding
 *   `deps.fs.backup`/`.remove` implementation (both OPTIONAL — see
 *   `ProjectFsPort`) fails LOUD for that one path (backups: recorded in
 *   `failed`, so the file is also never subsequently overwritten unbacked-up)
 *   or is swallowed as a best-effort no-op (removals: a stale foreign file
 *   left on disk is safe — the ledger itself no longer claims it either way).
 */
async function runManifestWriteSeam(
  deps: ProjectScaffoldFlowDeps,
  repoDir: string,
  candidates: AssetFile[],
  managedPaths: Set<string>,
  now: () => string,
): Promise<ManifestSeamResult> {
  const manifestPath = join(repoDir, PROJECT_MANIFEST_RELATIVE_PATH);
  const current = readProjectManifest(deps, repoDir);

  const existingFiles = new Map<string, string>();
  for (const candidate of candidates) {
    const existing = deps.fs.readFile(join(repoDir, candidate.path));
    if (existing !== null) existingFiles.set(candidate.path, sha256Hex(existing));
  }

  const candidatePaths = new Set(candidates.map((c) => c.path));
  const currentFiltered: SetupManifest | null =
    current === null
      ? null
      : {
          ...current,
          entries: current.entries.filter((e) => !managedPaths.has(e.path) || candidatePaths.has(e.path)),
        };

  const plan = planInstall(currentFiltered, { files: candidates }, existingFiles);
  const nowIso = now();

  const failed = new Map<string, string>();
  const committedBackups: string[] = [];

  for (const backupPath of plan.backups) {
    try {
      if (deps.fs.backup === undefined) {
        throw new Error(
          `ProjectFsPort.backup is not implemented by this port — cannot safely back up "${backupPath}" before overwrite`,
        );
      }
      const srcFull = join(repoDir, backupPath);
      const backupDir = dirname(join(repoDir, PROJECT_BACKUPS_RELATIVE_DIRNAME, nowIso, backupPath));
      deps.fs.mkdir(backupDir);
      deps.fs.backup(srcFull, backupDir);
      committedBackups.push(backupPath);
    } catch (error) {
      failed.set(backupPath, toMessage(error));
    }
  }

  for (const write of plan.writes) {
    if (failed.has(write.path)) continue; // its backup already failed — never overwrite un-backed-up content
    try {
      const fullPath = join(repoDir, write.path);
      deps.fs.mkdir(dirname(fullPath));
      deps.fs.writeFile(fullPath, write.content, write.kind === "hook" ? HOOK_FILE_MODE : TREE_YAML_MODE);
    } catch (error) {
      failed.set(write.path, toMessage(error));
    }
  }

  for (const removedPath of plan.removals) {
    try {
      if (deps.fs.remove === undefined) {
        throw new Error(`ProjectFsPort.remove is not implemented by this port — cannot remove now-undeclared "${removedPath}"`);
      }
      deps.fs.remove(join(repoDir, removedPath));
    } catch {
      // Best-effort: a removal failure just leaves a stale foreign file on disk.
      // The ledger no longer claims it either way (it's excluded below by
      // construction — `removals` paths are never in `candidates`), so this
      // can never desync the ledger from lore's own bookkeeping, only from
      // what's physically on disk.
    }
  }

  const previousEntryByPath = new Map((current?.entries ?? []).map((e) => [e.path, e] as const));
  const writeByPath = new Map(plan.writes.map((w) => [w.path, w] as const));

  const newFileEntries: SetupEntry[] = candidates
    .filter((c) => !failed.has(c.path))
    .map((file) => {
      const write = writeByPath.get(file.path);
      if (write !== undefined) {
        return { path: file.path, kind: file.kind, sha256: write.sha256, written_at: nowIso };
      }
      const prev = previousEntryByPath.get(file.path);
      return { path: file.path, kind: file.kind, sha256: file.sha256, written_at: prev?.written_at ?? nowIso };
    });

  // Entries this seam call doesn't own (e.g. a future co-located step's paths) pass through untouched.
  const passthroughEntries = (current?.entries ?? []).filter((e) => !managedPaths.has(e.path));
  const manifestEntries = [...passthroughEntries, ...newFileEntries];

  const manifest: SetupManifest = { version: PROJECT_MANIFEST_VERSION, claude_dir: repoDir, entries: manifestEntries };
  const validation = setupManifestSchema.safeParse(manifest);
  if (!validation.success) {
    return {
      failed,
      backups: committedBackups,
      manifestStatus: {
        status: "failed",
        detail: `computed project manifest failed schema validation: ${validation.error.message}`,
      },
    };
  }

  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const currentRaw = deps.fs.readFile(manifestPath);
  if (manifestContent === (currentRaw ?? "")) {
    return { failed, backups: committedBackups, manifestStatus: { status: "skipped", detail: manifestPath } };
  }

  try {
    deps.fs.mkdir(dirname(manifestPath));
    deps.fs.writeFile(manifestPath, manifestContent, 0o644);
    return { failed, backups: committedBackups, manifestStatus: { status: "done", detail: manifestPath } };
  } catch (error) {
    return { failed, backups: committedBackups, manifestStatus: { status: "failed", detail: toMessage(error) } };
  }
}

/** Finalizes one ledger-tracked candidate's report row once the seam has run. */
function finalizeHookRow(file: string, wasMissing: boolean, failed: Map<string, string>): HookFileResult {
  const failure = failed.get(file);
  if (failure !== undefined) return { file, status: "failed", detail: failure };
  return { file, status: wasMissing ? "done" : "skipped" };
}

/** Finalizes the tree_yaml candidate's report row once the seam has run. */
function finalizeTreeYamlRow(wasMissing: boolean, failed: Map<string, string>): SimpleStepResult {
  const failure = failed.get(TREE_TEMPLATE_TARGET_NAME);
  if (failure !== undefined) return { status: "failed", detail: failure };
  return { status: wasMissing ? "done" : "skipped", detail: TREE_TEMPLATE_TARGET_NAME };
}

// ─── Steps ───────────────────────────────────────────────────────────────────

async function runInitStep(deps: ProjectScaffoldFlowDeps, repoDir: string): Promise<SimpleStepResult> {
  const loreDirPath = join(repoDir, ".lore");
  if (deps.fs.exists(loreDirPath)) {
    return { status: "skipped", detail: loreDirPath };
  }
  try {
    const result = await deps.initCorpus(repoDir);
    if (!result.ok) {
      return { status: "failed", detail: describeError(result.error) };
    }
    return { status: "done", detail: loreDirPath };
  } catch (error) {
    return { status: "failed", detail: toMessage(error) };
  }
}

/** One hooks/* file, classified but NOT yet written — a candidate for the shared manifest write seam. */
interface PendingHookFile {
  file: string;
  candidate: AssetFile;
  /** `true` when the file was absent on disk (a fresh write); `false` when present-and-byte-identical (a tracked skip). */
  wasMissing: boolean;
}

/**
 * Classifies every `hooks/*` asset — NEVER writes to disk itself (SPEC-060
 * D1: writing is centralized in {@link runManifestWriteSeam}). A file that
 * exists with content differing from the shipped asset is finalized
 * IMMEDIATELY as `"conflict"` (terminal — repo hooks may be user-customized,
 * see module doc) and is NEVER added to `pending`, so it can never reach the
 * ledger or the write seam. An asset-load failure is likewise finalized
 * immediately as `"failed"`.
 */
async function runHooksStep(
  deps: ProjectScaffoldFlowDeps,
  repoDir: string,
): Promise<{ terminal: HookFileResult[]; pending: PendingHookFile[] }> {
  const hooksDir = join(repoDir, "hooks");
  const terminal: HookFileResult[] = [];
  const pending: PendingHookFile[] = [];

  for (const name of HOOK_ASSET_NAMES) {
    const targetRelPath = `hooks/${name}`;
    const targetAbsPath = join(hooksDir, name);
    try {
      const assetResult = await deps.assets.readAsset(name);
      if (!assetResult.ok) {
        terminal.push({ file: targetRelPath, status: "failed", detail: describeError(assetResult.error) });
        continue;
      }
      const content = assetResult.value;
      const existing = deps.fs.readFile(targetAbsPath);
      const candidate: AssetFile = {
        path: targetRelPath,
        kind: "hook",
        content,
        sha256: sha256Hex(content),
        executable: true,
      };

      if (existing === null) {
        pending.push({ file: targetRelPath, candidate, wasMissing: true });
      } else if (existing === content) {
        pending.push({ file: targetRelPath, candidate, wasMissing: false });
      } else {
        terminal.push({
          file: targetRelPath,
          status: "conflict",
          detail: "existing file differs from the shipped asset — left untouched",
        });
      }
    } catch (error) {
      terminal.push({ file: targetRelPath, status: "failed", detail: toMessage(error) });
    }
  }

  return { terminal, pending };
}

/**
 * Classifies `lore.tree.yaml` — NEVER writes to disk itself (see
 * `runHooksStep`'s doc for the same D1 restructuring). Preserves the exact
 * pre-D1 OUTWARD contract ("present → always `skipped`, regardless of content
 * — no content diff") but now ALSO determines, for ledger purposes only,
 * whether a present file's content matches the template: a match becomes a
 * tracked-skip candidate; a mismatch (or an unreadable-but-present file,
 * treated conservatively as a mismatch) is excluded from the ledger entirely
 * — lore stops claiming a path the moment it can no longer verify its
 * content, without changing the visible `"skipped"` status either way.
 */
async function runTreeYamlStep(
  deps: ProjectScaffoldFlowDeps,
  repoDir: string,
): Promise<{ terminal?: SimpleStepResult; pending?: { candidate: AssetFile; wasMissing: boolean } }> {
  const targetAbsPath = join(repoDir, TREE_TEMPLATE_TARGET_NAME);
  try {
    const assetResult = await deps.assets.readAsset(TREE_TEMPLATE_ASSET_NAME);
    if (!assetResult.ok) {
      return { terminal: { status: "failed", detail: describeError(assetResult.error) } };
    }
    const content = assetResult.value;
    const candidate: AssetFile = {
      path: TREE_TEMPLATE_TARGET_NAME,
      kind: PROJECT_ASSET_KIND,
      content,
      sha256: sha256Hex(content),
    };

    if (!deps.fs.exists(targetAbsPath)) {
      return { pending: { candidate, wasMissing: true } };
    }
    const existing = deps.fs.readFile(targetAbsPath);
    if (existing === content) {
      return { pending: { candidate, wasMissing: false } };
    }
    return { terminal: { status: "skipped", detail: TREE_TEMPLATE_TARGET_NAME } };
  } catch (error) {
    return { terminal: { status: "failed", detail: toMessage(error) } };
  }
}

async function runGitHooksPathStep(deps: ProjectScaffoldFlowDeps, repoDir: string): Promise<GitHooksPathResult> {
  try {
    const getResult = await deps.exec.run(["git", "config", "--get", "core.hooksPath"], repoDir);
    const priorValue = getResult.code === 0 ? getResult.stdout.trim() : null;

    if (priorValue === "hooks") {
      return { status: "skipped", prior_value: priorValue };
    }

    const setResult = await deps.exec.run(["git", "config", "core.hooksPath", "hooks"], repoDir);
    if (setResult.code !== 0) {
      return {
        status: "failed",
        prior_value: priorValue,
        detail: setResult.stderr.trim() || `git config exited with code ${setResult.code}`,
      };
    }

    return { status: "done", prior_value: priorValue };
  } catch (error) {
    return { status: "failed", prior_value: null, detail: toMessage(error) };
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Scaffolds `opts.repoDir` with the Lore-governed project workflow: `.lore/`
 * init (skipped if already present), `assets/project/` hooks copied into
 * `<repo>/hooks/` (conflict-checked, never clobbered), `lore.tree.yaml`
 * written from template (skipped if already present), and
 * `git config core.hooksPath hooks` wired via the injected {@link ExecPort}.
 * SPEC-060 D1 additionally records every hooks/tree_yaml write into a
 * repo-local ledger at `.lore/.lore-project-manifest.json` via
 * {@link runManifestWriteSeam} — see this module's top-level doc comment.
 *
 * All four scaffold steps run UNCONDITIONALLY and INDEPENDENTLY of each
 * other's outcome — a failure in one step never prevents the remaining steps
 * from being attempted (see module invariants). The function itself only
 * ever returns a top-level `err` for a structurally invalid `opts.repoDir`;
 * every IO failure is instead captured as a `"failed"`/`"conflict"` status
 * inside the returned report.
 *
 * @param deps - The four narrow ports (fs/exec/initCorpus/assets), adapter-provided.
 * @param opts - `{ repoDir }` — the absolute path to the target repo root.
 * @param now - Time seam (mirrors `SetupService.install`'s convention) —
 *   resolved ONCE per call by the manifest write seam; also doubles as the
 *   backup-run directory key a future uninstall pass would derive from each
 *   entry's `written_at` (SPEC-060 D2, mirrors `SetupService.uninstall`).
 * @returns `ok(report)` with the full per-step outcome, or
 *   `err(VALIDATION_ERROR)` when `repoDir` is not a non-empty absolute path.
 * @example
 * const result = await scaffoldProject(deps, { repoDir: "/path/to/repo" });
 * if (result.ok) console.log(result.value.git_hooks_path.status);
 */
export async function scaffoldProject(
  deps: ProjectScaffoldFlowDeps,
  opts: ProjectScaffoldOptions,
  now: () => string = defaultNow,
): Promise<Result<ProjectScaffoldReport, LoreError>> {
  const { repoDir } = opts;
  if (!repoDir || !repoDir.startsWith("/")) {
    return err({
      code: "VALIDATION_ERROR",
      field: "repoDir",
      message: "repoDir must be a non-empty absolute path",
      value: repoDir,
    });
  }

  const init = await runInitStep(deps, repoDir);

  const hooksOutcome = await runHooksStep(deps, repoDir);
  const treeYamlOutcome = await runTreeYamlStep(deps, repoDir);

  const candidates: AssetFile[] = [
    ...hooksOutcome.pending.map((p) => p.candidate),
    ...(treeYamlOutcome.pending ? [treeYamlOutcome.pending.candidate] : []),
  ];
  const managedPaths = new Set<string>([
    ...HOOK_ASSET_NAMES.map((name) => `hooks/${name}`),
    TREE_TEMPLATE_TARGET_NAME,
  ]);

  const seam = await runManifestWriteSeam(deps, repoDir, candidates, managedPaths, now);

  const hooks: HookFileResult[] = [
    ...hooksOutcome.terminal,
    ...hooksOutcome.pending.map(({ file, wasMissing }) => finalizeHookRow(file, wasMissing, seam.failed)),
  ];

  const tree_yaml: SimpleStepResult = treeYamlOutcome.terminal
    ? treeYamlOutcome.terminal
    : finalizeTreeYamlRow(treeYamlOutcome.pending!.wasMissing, seam.failed);

  const git_hooks_path = await runGitHooksPathStep(deps, repoDir);

  return ok({ init, hooks, tree_yaml, git_hooks_path, manifest: seam.manifestStatus, backups: seam.backups });
}
