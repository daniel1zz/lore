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
 * **SPEC-060 D3 / SPEC-076 D7 — repo-root `.gitignore` (append) and
 * `CLAUDE.md` (marker-section rewrite, migrated off SPEC-060 D4's original
 * blanket backup-then-overwrite) stubs.** Both route through the SAME `plannedWrite`
 * collector (`runManifestWriteSeam`) as the D1 hooks/tree_yaml candidates —
 * per the spec's own §Design ("Each of the four existing steps plus the two
 * new file steps (D3/D4) routes its writes through one `plannedWrite`
 * collector") — but with two DIFFERENT candidate-construction strategies:
 *   - `.gitignore` (`runGitignoreStep`) computes its candidate content
 *     DYNAMICALLY each run: the current on-disk bytes (verbatim, if any) plus
 *     the shipped `gitignore.template` block appended, UNLESS that block's
 *     `# --- lore ---` marker is already present on disk (substring check),
 *     in which case the candidate content is simply the unchanged on-disk
 *     bytes (byte-identical -> `planInstall` classifies it a `skip`, closing
 *     AC-060-4's "third run appends 0 additional blocks"). Because the
 *     existing bytes are ALWAYS a literal prefix of the appended candidate,
 *     `planInstall`'s blanket "differs -> write + backup" rule (see
 *     `@lore/core/setup-manifest.ts`) may also back up a pre-existing
 *     `.gitignore` before the FIRST append — this is a harmless, defensive
 *     byproduct of reusing the same rule uniformly (nothing is ever lost;
 *     the original bytes remain a prefix of the final file either way), not
 *     a design requirement of D3.
 *   - `CLAUDE.md` (`runClaudeMdStep`, SPEC-076 D7 — MIGRATED off SPEC-060 D4's
 *     blanket backup-then-overwrite) computes its candidate content
 *     DYNAMICALLY, same as `.gitignore` above, but marker-SECTION-scoped
 *     rather than whole-file: the shipped `CLAUDE.md.template` asset is
 *     itself wrapped in a `# ─── lore governance (managed) ───` /
 *     `# ─── end lore governance ───` marker pair (mirrors `.gitignore`'s
 *     marker-embedded-in-the-shipped-asset convention). **SPEC-context-verb-
 *     family D4 (splice SSOT)**: `computeClaudeMdSplice` delegates the actual
 *     zone-splice math to `service/context-projection.ts::spliceManagedSections`
 *     (the SAME pure module `flows/context-flow.ts` uses) — the shipped
 *     template's whole managed body becomes ONE section (`CLAUDE_MD_SECTION_ID`),
 *     resolving three legacy on-disk forms to one candidate each: absent ->
 *     the template verbatim, now WRAPPED AND FINGERPRINTED by the shared
 *     splice; byte-identical to the OLD SPEC-060 D4 un-marked stub -> treated
 *     as an empty effective input so the shared splice creates a fresh
 *     (fingerprinted) zone in its place (it was lore's own prior output —
 *     nothing of the user's to lose); anything else (genuinely
 *     user-authored/modified, or an already marker-wrapped zone from a PRIOR
 *     run of this same refactored flow) is passed through to
 *     `spliceManagedSections` verbatim, which appends/rebuilds/protects the
 *     zone per its own five-state contract (created/updated/unchanged/
 *     diverged_skip/appended — see that function's doc comment). A zone
 *     wrapped by a PRE-this-refactor lore build (no fingerprint comment
 *     inside) is a legacy shape the shared parser does not tolerate — it
 *     fails loud (`VALIDATION_ERROR`), surfaced as `"failed"` by
 *     `runClaudeMdStep`, same as any other structurally malformed input; see
 *     `computeClaudeMdSplice`'s own doc comment for the full decision tree.
 * Because BOTH candidates may legitimately be classified `write` even when
 * their target was already present (unlike hooks/tree_yaml, which exclude a
 * present-and-different path from `candidates` entirely and so never reach
 * this ambiguity), their FINAL report status can't be derived from a simple
 * "was it missing before this run?" flag the way `finalizeHookRow`/
 * `finalizeTreeYamlRow` do — `runManifestWriteSeam` additionally returns
 * `written: Set<string>` (the paths `planInstall` classified `write` AND
 * whose write attempt did not fail) for `finalizeGitignoreRow`/
 * `finalizeClaudeMdRow` to key off instead.
 *
 * **`backups` semantics — a single resolved ambiguity (SPEC-060 D6).** T1's
 * original `ProjectScaffoldReport.backups` doc comment was ambiguous between
 * "the ORIGINAL path that got backed up" (the machine-installer
 * `SetupReceipt.backups` convention) and "the BACKUP DESTINATION path" (what
 * `adapters/cli/setup-render.ts`'s D6 loud-reporting renderer — and its
 * already-authored test fixtures — assume, since a recovery pointer is only
 * useful if it names WHERE to recover FROM). This module resolves it in favor
 * of the DESTINATION reading: `backups: string[]` holds repo-relative
 * `.lore/.lore-backups/<iso>/<original-path>` strings. The original path is
 * never lost — it's the destination's own suffix after the `<iso>/` segment
 * — so nothing is sacrificed by not ALSO carrying a separate `original` field;
 * every per-step report row (e.g. `claude_md.detail`) already names the
 * target file independently, so a reader is never left wondering "backup of
 * what."
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
 *     original ledger-tracked steps (hooks/tree_yaml) ever exercises the
 *     backup path (see the conflict bullet above) — it IS exercised by the
 *     `.gitignore` append step (first-append backup, see the module's own
 *     D3 bullet above) and by the `CLAUDE.md` marker-section-rewrite step
 *     (SPEC-076 D7, R3's "mandatory backup first" — falls out of
 *     `planInstall`'s generic differs-then-backup rule whenever an existing
 *     file's computed candidate differs from its on-disk bytes).
 *
 * Side-effect class: IO (delegates entirely to the injected ports)
 * Source: SPEC-046 §Design, §Scope; task AC-046-C. SPEC-060 §Design, D1. SPEC-076 §C1 D7.
 *   SPEC-context-verb-family-two-zone-claude-md-anatomy-lore §Design Decisions D4
 *   (splice SSOT — this flow consumes `spliceManagedSections`, it no longer
 *   carries its own marker-splice implementation).
 */

import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  CLAUDE_MD_MARKER_START,
  CLAUDE_MD_MARKER_END,
  err,
  ok,
  planInstall,
  setupManifestSchema,
} from "@lore/core";
import type {
  AdoptionMode,
  AssetFile,
  FsProbe,
  LoreError,
  MemoryFileBudgets,
  Result,
  SetupEntry,
  SetupEntryKind,
  SetupManifest,
} from "@lore/core";
import { runMemoryFileChecks } from "../service/claude-md-admission.js";
import { spliceManagedSections } from "../service/context-projection.js";
import type { ManagedSection, SpliceResult } from "../service/context-projection.js";

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
   *
   * The METHOD is optional; its `opts.boundary` (the repo root) is NOT — D8 of
   * spec-lore-setup-deletes-repo-source-through-dev-symlinks. An implementation
   * MUST refuse a path whose ancestor inside that boundary is a symlink rather
   * than follow it. Required so `tsc` — not a remembered list of call sites —
   * enumerates every caller that forgot it.
   */
  remove?(path: string, opts: { boundary: string }): void;
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
 * filename (e.g. `"pre-push"`, `"lore.tree.yaml.template"`) — never
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

/** One shipped consumer skill file: `path` is relative to the assets root (`skills/lore-baseline/SKILL.md`). */
export interface ProjectSkillAsset {
  path: string;
  content: string;
}

/**
 * Lists the `skills/lore-baseline/**` authoring-skill files shipped in the assets SSOT (Baseline slice 3a, BL-8).
 * Kept apart from {@link ProjectAssetSource} (which reads single named files under `assets/project/`) because the
 * set is a directory tree whose membership the flow must not hard-code.
 *
 * @returns `err` when the skill tree is missing/unreadable or empty — never throws, never an empty `ok`.
 */
export interface ProjectSkillAssetSource {
  listSkillAssets(): Result<ProjectSkillAsset[], LoreError>;
}

/** What {@link SeedAcCiteMode} did: `written` (mode was absent) or `kept` (an explicit mode already there). */
export type AcCiteSeedResult = { status: "written" } | { status: "kept"; existing: string };

/**
 * Seeds `workflow.gates."ac-cite".mode: report` into the target repo's `.lore/config.yaml` ONLY when `mode` is
 * absent (an explicit off | report | enforce and `armed_branches` are never touched). A real write is an AUDITED
 * adoption (BR-987): the adapter records the same `baseline_adopt` row `lore baseline adopt` writes, so status
 * reports the seeded mode as `audited`; a kept mode writes no row.
 *
 * @returns `err` when the config cannot be read or written or the audit row cannot be appended — never throws.
 */
export type SeedAcCiteMode = (repoDir: string) => Promise<Result<AcCiteSeedResult, LoreError>>;

/**
 * What {@link WriteAdoptionMode} did with `context.memory_files.adoption`:
 * `written` — the key was absent and now holds the requested mode; `kept` —
 * the key already held `existing`, nothing was written (an explicit value is
 * never overwritten, spec-claude-md-root-section-structure-check-and-adoption-mode D4).
 */
export type AdoptionWriteOutcome = { status: "written" } | { status: "kept"; existing: AdoptionMode };

/**
 * Persists the adoption mode into the target repo's `.lore/config.yaml`
 * (`context.memory_files.adoption`) — ONLY when that key is absent. The real
 * implementation (adapters/cli/commands/setup.ts) reads the current value
 * first; this flow never imports a config reader/writer or `node:fs` for it.
 *
 * @param repoDir - Absolute repo root whose `.lore/config.yaml` is updated.
 * @param mode - The mode judged on the POST-SPLICE `CLAUDE.md` content.
 * @returns `err` when the config cannot be read or written — never throws.
 */
export type WriteAdoptionMode = (repoDir: string, mode: AdoptionMode) => Result<AdoptionWriteOutcome, LoreError>;

/**
 * Resolves the target repo's REAL `context.memory_files` budgets (its own
 * `.lore/config.yaml`, read AFTER the init step created it) so the adoption
 * judgement uses the same ceilings `lore status --check-claude-md` will later
 * enforce — never schema defaults.
 *
 * @param repoDir - Absolute repo root.
 * @returns `err` when the config cannot be loaded — never throws.
 */
export type ResolveMemoryFileBudgets = (repoDir: string) => Result<MemoryFileBudgets, LoreError>;

/**
 * What the adoption judgement needs to resolve code references: a read-only probe of the
 * target repo and its context fragments, so the verdict counts a dangling `path#Symbol` the
 * way `lore status --check-claude-md` later will.
 *
 * @param repoDir - Absolute repo root.
 */
export type ResolveReferenceContext = (repoDir: string) => {
  probe: FsProbe;
  referenceDocuments: ReadonlyArray<{ path: string; content: string }>;
};

/**
 * The ports {@link scaffoldProject} depends on, bundled for constructor injection.
 *
 * `writeAdoptionMode` + `resolveMemoryFileBudgets` are OPTIONAL in the TYPE only
 * (making them required would break unanchored fixtures that predate the adoption
 * step). Absence is NOT silent: the report carries an `adoption` row with
 * `status: "skipped"` naming the missing port(s). The production adapter supplies both.
 */
export interface ProjectScaffoldFlowDeps {
  fs: ProjectFsPort;
  exec: ExecPort;
  initCorpus: InitCorpus;
  assets: ProjectAssetSource;
  writeAdoptionMode?: WriteAdoptionMode;
  resolveMemoryFileBudgets?: ResolveMemoryFileBudgets;
  /** Same optionality and loud-skip rule as the two ports above; the production adapter supplies it. */
  resolveReferenceContext?: ResolveReferenceContext;
  /** BL-8 — the authoring-skill source; absent means the `skills` row is omitted (bare-port test fixtures). */
  skillAssets?: ProjectSkillAssetSource;
  /** BL-8 — the ac-cite mode seed; absent means the `ac_cite` row is omitted (bare-port test fixtures). */
  seedAcCiteMode?: SeedAcCiteMode;
}

/**
 * Outcome of the adoption step (spec D4). `mode` is the value judged on the
 * post-splice root file — ABSENT exactly when nothing was judged (`skipped`, or
 * `failed` before judgement). `status` says whether it reached the config.
 * `checklist` is the migration checklist — one line per would-be deterministic
 * finding — populated ONLY when `mode` is `warn`.
 */
export interface AdoptionStepResult {
  status: "written" | "kept" | "failed" | "skipped";
  mode?: AdoptionMode;
  /** `kept`: the explicit value already in config; `failed`/`skipped`: the reason. */
  detail?: string;
  checklist: string[];
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
  /** Repo-relative target path, e.g. `"hooks/pre-push"`. */
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
  /**
   * SPEC-060 D3 — outcome of the repo-root `.gitignore` append step. `"done"`
   * means a write happened this run (fresh file, OR the `# --- lore ---`
   * block was appended); `"skipped"` means the marker was already present
   * and the file is unchanged. See `runGitignoreStep`'s doc comment.
   */
  gitignore: SimpleStepResult;
  /**
   * SPEC-076 D7 — outcome of the repo-root `CLAUDE.md` marker-section-rewrite
   * step (migrated off SPEC-060 D4's blanket backup-then-overwrite). `"done"`
   * covers a fresh write, a full replace of a byte-identical legacy pre-076
   * stub, a section splice over an already marker-wrapped file, AND an
   * append of the marker-wrapped section onto genuinely user-authored
   * content — the last three back the OLD bytes up first whenever the
   * computed candidate differs from disk (see `backups` below);
   * `"skipped"` means the computed candidate already matched what's on disk
   * byte-for-byte (a repeat converge with nothing to change). See
   * `computeClaudeMdSplice`'s doc comment for the full decision tree.
   */
  claude_md: SimpleStepResult;
  git_hooks_path: GitHooksPathResult;
  /**
   * Adoption-mode write (spec-claude-md-root-section-structure-check-and-adoption-mode
   * D4) — absent ONLY when the CLAUDE.md step itself failed (nothing to judge).
   * A missing adoption port is a `status: "skipped"` row, never absence.
   * See {@link AdoptionStepResult}.
   */
  adoption?: AdoptionStepResult;
  /**
   * BL-8 (AC-BLS3-7) — the `skills/lore-baseline/**` install into `.claude/` (ledger kind `skill`). `done` = at
   * least one file written this run; `skipped` = every file already byte-identical; `failed` names the cause.
   * Absent only when `deps.skillAssets` was not injected.
   */
  skills?: SimpleStepResult;
  /**
   * BL-8 (AC-BLS3-7) — the `workflow.gates."ac-cite".mode` seed: `done` = seeded `report`, `skipped` = an explicit
   * mode was kept (detail names it). Absent only when `deps.seedAcCiteMode` was not injected.
   */
  ac_cite?: SimpleStepResult;
  /**
   * SPEC-060 D1 — outcome of writing `.lore/.lore-project-manifest.json`
   * itself (the ledger file), LAST, after every tracked write/backup/removal
   * has been attempted. `"skipped"` means the computed manifest content was
   * already byte-identical to what's on disk (I2-style idempotency).
   */
  manifest: SimpleStepResult;
  /**
   * SPEC-060 D1/D6 — repo-relative BACKUP DESTINATION paths written this run
   * (e.g. `.lore/.lore-backups/2026-07-21T.../CLAUDE.md`), before the
   * corresponding target was overwritten with different content — see this
   * module's top-level doc comment ("`backups` semantics") for why this is
   * the DESTINATION path, not the original overwritten path (the original is
   * always recoverable as the destination's own suffix after the `<iso>/`
   * segment). Always `[]` for the two ORIGINAL D1 ledger-tracked steps
   * (hooks/tree_yaml never overwrite differing content — see module doc);
   * populated by the D3/D4 steps whenever an existing `.gitignore`/`CLAUDE.md`
   * differed from its computed candidate content.
   */
  backups: string[];
}

// ─── Asset/target name tables ───────────────────────────────────────────────

/** The `assets/project/*` hook filenames copied verbatim into `<repo>/hooks/`. */
export const HOOK_ASSET_NAMES = [
  "pre-push",
  // The main-ref guard (spec-main-advances-only-through-lore-integrate-per-session, BR-1246): refuses every move of
  // refs/heads/main that does not carry the `lore integrate` marker. Needs git >= 2.28 (see MIN_GIT_FOR_MAIN_REF_HOOK).
  "reference-transaction",
] as const;

/** The oldest git that runs the `reference-transaction` hook: 2.28. */
export const MIN_GIT_FOR_MAIN_REF_HOOK = { major: 2, minor: 28 } as const;

/**
 * Reads `git version 2.39.3 (Apple Git-145)` into `{ major: 2, minor: 39 }`; `undefined` when the text is not a git
 * version line (the caller refuses: an unreadable version cannot be proven to support the main-ref hook).
 */
export function parseGitVersion(text: string): { major: number; minor: number; raw: string } | undefined {
  const match = /git version (\d+)\.(\d+)/.exec(text);
  if (match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), raw: text.trim() };
}

/** Hook scripts must remain executable after copy (SPEC-046 §Design "execute bits preserved"). */
const HOOK_FILE_MODE = 0o755;

const TREE_TEMPLATE_ASSET_NAME = "lore.tree.yaml.template";
const TREE_TEMPLATE_TARGET_NAME = "lore.tree.yaml";
const TREE_YAML_MODE = 0o644;

/** The `assets/project/gitignore.template` asset — the `# --- lore ---`-delimited block appended to the repo-root `.gitignore` (SPEC-060 D3). */
const GITIGNORE_ASSET_NAME = "gitignore.template";
const GITIGNORE_TARGET_NAME = ".gitignore";
/** Delimiter marker `runGitignoreStep` searches for (substring check) to decide whether the block was already appended. */
const GITIGNORE_MARKER = "# --- lore ---";

/**
 * The `assets/project/CLAUDE.md.template` asset — the repo-root `CLAUDE.md`
 * stub, marker-section rewrite (SPEC-076 D7, migrated off SPEC-060 D4's
 * blanket backup-then-overwrite). The shipped asset is itself wrapped in
 * `CLAUDE_MD_MARKER_START`/`CLAUDE_MD_MARKER_END` (mirrors `GITIGNORE_MARKER`'s
 * marker-embedded-in-the-asset convention) — see `computeClaudeMdSplice`.
 * The two marker constants themselves are imported from `@lore/core`
 * (SPEC-context-verb-family D4/D5 — the shared `spliceManagedSections` splice
 * SSOT owns this vocabulary now; this flow no longer declares its own copy).
 */
const CLAUDE_MD_ASSET_NAME = "CLAUDE.md.template";
/**
 * `assets/project/CLAUDE.md.skeleton` — the three user-owned H2 sections
 * (What This Is / Commands / Architecture) written ONLY when CLAUDE.md is
 * absent, ahead of the managed block (which supplies Module Index / Finding
 * Live Project State). Never applied to an existing file.
 */
const CLAUDE_MD_SKELETON_ASSET_NAME = "CLAUDE.md.skeleton";
const CLAUDE_MD_TARGET_NAME = "CLAUDE.md";
/** Stable section id this flow's single governance blob is spliced under (SPEC-context-verb-family D4) — the shared module's per-section fingerprint is keyed by this id. */
const CLAUDE_MD_SECTION_ID = "governance";

// ─── SPEC-060 D1 — repo-level install ledger constants ─────────────────────

/**
 * Repo-relative path to the ledger this flow maintains (mirrors
 * `SetupService`'s `.lore-setup-manifest.json`, one directory tier down).
 * Exported so `adapters/cli/commands/setup.ts` can derive the manifest's
 * absolute path for its receipt/`--json` output without re-declaring this
 * literal a second time.
 */
export const PROJECT_MANIFEST_RELATIVE_PATH = ".lore/.lore-project-manifest.json";
/**
 * Repo-relative directory backups land under, one `<iso>` subdirectory per
 * write-seam run that performed at least one backup. Exported (SPEC-060 T5
 * follow-up) so `flows/setup-project-uninstall.ts` reconstructs backup paths
 * from this SAME literal instead of maintaining its own duplicate — the two
 * flows read/write the identical `.lore/.lore-backups/<iso>/<path>` layout
 * and must never drift.
 */
export const PROJECT_BACKUPS_RELATIVE_DIRNAME = ".lore/.lore-backups";
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
 * `governance/claude-md-contract.md`). Chosen over widening `SETUP_ENTRY_KINDS`
 * itself because that enum backs an exhaustive `Record<..., string>` in
 * `adapters/cli/setup-render.ts`. Reused unchanged by the SPEC-060 D3/D4
 * `.gitignore`/`CLAUDE.md` candidates below — four total consumers now
 * (tree_yaml, gitignore, claude_md, plus this constant's own original
 * tree_yaml use) — unless a later task explicitly revisits the kind
 * taxonomy.
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

/** The manifest write seam's outcome — folded into {@link ProjectScaffoldReport}'s `manifest`/`backups`/`gitignore`/`claude_md` fields by {@link scaffoldProject}. */
interface ManifestSeamResult {
  /** Repo-relative path → error message, for any candidate whose backup or write attempt threw. */
  failed: Map<string, string>;
  /**
   * Repo-relative BACKUP DESTINATION paths (e.g.
   * `.lore/.lore-backups/<iso>/CLAUDE.md`) successfully written before an
   * overwrite, this run — see this module's top-level doc comment
   * ("`backups` semantics") for why this is the destination, not the
   * original overwritten path.
   */
  backups: string[];
  /**
   * Repo-relative paths `planInstall` classified `write` AND whose write
   * attempt did NOT fail this run — i.e. every candidate actually persisted
   * to disk, fresh or overwritten. `runGitignoreStep`/`runClaudeMdStep`'s
   * candidates may legitimately appear here even when their target already
   * existed (unlike hooks/tree_yaml, which never do — see module doc), so
   * `finalizeGitignoreRow`/`finalizeClaudeMdRow` key off this set rather than
   * a "was it missing before this run?" flag.
   */
  written: Set<string>;
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
      // reason: the backup DESTINATION's repo-relative path is exactly
      // join(PROJECT_BACKUPS_RELATIVE_DIRNAME, nowIso, backupPath) — its own
      // dirname is where deps.fs.backup(src, destDir) must copy the file
      // (destDir + basename(backupPath) reconstructs this SAME path). See
      // this module's top-level doc comment ("`backups` semantics") for why
      // the report tracks the destination, not the original, path.
      const backupDestRel = join(PROJECT_BACKUPS_RELATIVE_DIRNAME, nowIso, backupPath);
      const backupDestAbs = join(repoDir, backupDestRel);
      const backupDir = dirname(backupDestAbs);
      deps.fs.mkdir(backupDir);
      deps.fs.backup(srcFull, backupDir);
      committedBackups.push(backupDestRel);
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

  // Every candidate planInstall classified `write` whose write attempt did
  // NOT fail this run — see ManifestSeamResult.written's doc comment for why
  // D3/D4's finalize functions key off this instead of a "was it missing"
  // flag (their candidate may legitimately be a `write` even when the
  // target already existed on disk, unlike hooks/tree_yaml).
  const written = new Set(plan.writes.filter((w) => !failed.has(w.path)).map((w) => w.path));

  for (const removedPath of plan.removals) {
    try {
      if (deps.fs.remove === undefined) {
        throw new Error(`ProjectFsPort.remove is not implemented by this port — cannot remove now-undeclared "${removedPath}"`);
      }
      // `boundary` is REQUIRED here, not decorative: without it removeProjectPath
      // skips its ancestor-symlink scan and deletes THROUGH a developer's link
      // (spec-lore-setup-deletes-repo-source-through-dev-symlinks D3/D4). This
      // path fires on an ordinary `lore setup --project` re-run whenever a
      // previously-tracked file drops out of the candidate set, so it is not an
      // uninstall-only concern. A refusal lands in the catch below and leaves
      // the path in place — the correct outcome for a best-effort sweep.
      deps.fs.remove(join(repoDir, removedPath), { boundary: repoDir });
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

  // reason: the priors are the ledger's record of what an EARLIER run replaced; rebuilding the manifest from entries
  // alone would drop them and a later uninstall could no longer restore (BR-834/BR-837/BR-845).
  const manifest: SetupManifest = {
    version: PROJECT_MANIFEST_VERSION,
    claude_dir: repoDir,
    entries: manifestEntries,
    ...(current?.project_priors === undefined ? {} : { project_priors: current.project_priors }),
  };
  const validation = setupManifestSchema.safeParse(manifest);
  if (!validation.success) {
    return {
      failed,
      backups: committedBackups,
      written,
      manifestStatus: {
        status: "failed",
        detail: `computed project manifest failed schema validation: ${validation.error.message}`,
      },
    };
  }

  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const currentRaw = deps.fs.readFile(manifestPath);
  if (manifestContent === (currentRaw ?? "")) {
    return { failed, backups: committedBackups, written, manifestStatus: { status: "skipped", detail: manifestPath } };
  }

  try {
    deps.fs.mkdir(dirname(manifestPath));
    deps.fs.writeFile(manifestPath, manifestContent, 0o644);
    return { failed, backups: committedBackups, written, manifestStatus: { status: "done", detail: manifestPath } };
  } catch (error) {
    return { failed, backups: committedBackups, written, manifestStatus: { status: "failed", detail: toMessage(error) } };
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

/**
 * Classifies the repo-root `.gitignore` (SPEC-060 D3) — NEVER writes to disk
 * itself (same D1 restructuring as `runHooksStep`/`runTreeYamlStep`). Unlike
 * those two steps, this one's candidate content is computed DYNAMICALLY:
 *   - absent on disk -> candidate content is the shipped block verbatim.
 *   - present, `# --- lore ---` marker NOT found (substring check) -> the
 *     current on-disk bytes, PLUS a separating newline (only if the existing
 *     bytes don't already end in one; omitted entirely for an empty file),
 *     PLUS the shipped block — the original bytes are ALWAYS a literal
 *     prefix of this candidate.
 *   - present, marker already found -> the current on-disk bytes UNCHANGED
 *     (candidate content === existing), which makes `planInstall` classify
 *     it a `skip` (byte-identical) — this is what closes AC-060-4's "third
 *     run appends 0 additional blocks" with zero extra logic downstream.
 * Never returns `terminal: {status: "skipped"}` the way `runTreeYamlStep`
 * does — always either `terminal: {status: "failed"}` (asset load threw) or
 * a `pending` candidate, deferring the write/skip decision to the shared
 * seam's `planInstall` call.
 */
async function runGitignoreStep(
  deps: ProjectScaffoldFlowDeps,
  repoDir: string,
): Promise<{ terminal?: SimpleStepResult; pending?: AssetFile }> {
  const targetAbsPath = join(repoDir, GITIGNORE_TARGET_NAME);
  try {
    const assetResult = await deps.assets.readAsset(GITIGNORE_ASSET_NAME);
    if (!assetResult.ok) {
      return { terminal: { status: "failed", detail: describeError(assetResult.error) } };
    }
    const block = assetResult.value;
    const existing = deps.fs.readFile(targetAbsPath);

    let content: string;
    if (existing === null) {
      content = block;
    } else if (existing.includes(GITIGNORE_MARKER)) {
      content = existing; // already appended — byte-identical candidate, planInstall skips it
    } else {
      const separator = existing.length === 0 ? "" : existing.endsWith("\n") ? "" : "\n";
      content = `${existing}${separator}${block}`;
    }

    return {
      pending: { path: GITIGNORE_TARGET_NAME, kind: PROJECT_ASSET_KIND, content, sha256: sha256Hex(content) },
    };
  } catch (error) {
    return { terminal: { status: "failed", detail: toMessage(error) } };
  }
}

/**
 * Splits a marker-wrapped `CLAUDE.md.template` asset into its managed
 * BODY — everything strictly between the marker pair, exclusive of both
 * marker lines and their own trailing newlines. This is an ASSET-framing
 * concern (unwrapping the shipped file so its bare prose can be handed to
 * `spliceManagedSections` as one section's body) — NOT the zone-splice math
 * itself; that lives entirely in `service/context-projection.ts` now
 * (SPEC-context-verb-family D4). Used by `computeClaudeMdSplice` both to
 * build the section body it hands to the shared splice AND to derive the
 * SPEC-060 D4 legacy-stub comparison target from the CURRENT shipped
 * template, rather than duplicating that historical prose as a second
 * hand-maintained string in this module.
 *
 * @param requireWrapped - When `true`, a `template` that doesn't match the
 *   expected wrapper throws. When `false` (used ONLY for the fresh-install
 *   `existing === null` path — see `computeClaudeMdSplice`), an unwrapped
 *   `template` is tolerated verbatim as its own bare body instead: this
 *   mirrors the flow's pre-refactor behavior, which never validated the
 *   shipped template's wrapper shape on a from-scratch install (only the
 *   legacy-stub comparison path, reached exclusively when `existing !==
 *   null`, ever required it) — preserved here so a test/asset fixture that
 *   ships an unwrapped stub for a brand-new repo keeps working exactly as
 *   before.
 * @throws If `requireWrapped` and `template` doesn't start with
 *   `CLAUDE_MD_MARKER_START` and end with `CLAUDE_MD_MARKER_END` — a
 *   malformed shipped asset, never a runtime/user-data condition.
 *   `runClaudeMdStep`'s try/catch converts this into the same `"failed"`
 *   step outcome any other asset-load failure gets.
 */
function splitManagedClaudeMdTemplate(template: string, requireWrapped: boolean): string {
  const startLine = `${CLAUDE_MD_MARKER_START}\n`;
  const endLine = `${CLAUDE_MD_MARKER_END}\n`;
  if (template.startsWith(startLine) && template.endsWith(endLine)) {
    return template.slice(startLine.length, template.length - endLine.length);
  }
  if (requireWrapped) {
    throw new Error("CLAUDE.md.template asset is not wrapped in the expected lore governance markers");
  }
  return template;
}

/**
 * SPEC-context-verb-family D4 (splice SSOT) — computes the `CLAUDE.md` write
 * candidate by delegating the actual zone-splice math to
 * `service/context-projection.ts::spliceManagedSections`, the SAME pure
 * module `flows/context-flow.ts` uses for `lore context init`/`refresh`.
 * This flow no longer carries its own marker-splice implementation — the
 * shipped template's whole managed body becomes ONE section
 * (`CLAUDE_MD_SECTION_ID`), and the shared function assigns it a fresh
 * fingerprint hash whenever it creates or updates that section (installed
 * `CLAUDE.md` files GAIN a per-section fingerprint comment they never
 * carried before this refactor — a deliberate, accepted output-format
 * change, not a defect).
 *
 * Exactly ONE setup-project-flow-specific concern stays HERE as a thin
 * adapter (never forking the shared splice math itself):
 *   - SPEC-060 D4 legacy-stub migration: an on-disk file byte-identical to
 *     the CURRENT template's bare body (the OLD un-marked stub, markers
 *     never applied) is treated as an EMPTY effective input, so the shared
 *     splice creates a fresh (fingerprinted) zone in its place — lore's own
 *     prior output, nothing of the user's is at stake.
 *
 * Every other on-disk shape is handed to `spliceManagedSections` verbatim:
 * absent -> a fresh (fingerprinted) zone, the whole file; genuinely
 * user-authored/no-zone content -> the fingerprinted zone is APPENDED,
 * every existing byte preserved; an already marker-wrapped zone from a
 * PRIOR run of this SAME refactored flow -> only the governed span is
 * rebuilt (unchanged/updated/diverged_skip per the shared five-state
 * contract — see that function's own doc comment). A zone wrapped by a
 * PRE-this-refactor lore build (no fingerprint comment inside) is a legacy
 * shape the shared parser does not tolerate by design (fail loud, never a
 * partial splice) — its `VALIDATION_ERROR` is returned here unchanged, for
 * `runClaudeMdStep` to surface as `"failed"` exactly like any other
 * structurally malformed input, rather than this flow re-deriving zone
 * boundaries itself to paper over it (that would fork the splice math the
 * SSOT refactor exists to eliminate).
 *
 * @throws Only via `splitManagedClaudeMdTemplate`, and ONLY when `existing
 *   !== null` — a malformed SHIPPED asset (mirrors the pre-refactor
 *   behavior's own validation scope, see that function's `requireWrapped`
 *   doc). Never throws for any `existing` shape itself; a structurally
 *   broken `existing` zone comes back as `Result.err` instead (see above).
 */
function computeClaudeMdSplice(
  existing: string | null,
  template: string,
  skeleton: string,
): Result<SpliceResult, LoreError> {
  const templateBody = splitManagedClaudeMdTemplate(template, existing !== null);
  // reason: an ABSENT file starts from the skeleton so the managed block lands AFTER the three
  // user-owned sections (required order, spec D4); a byte-identical legacy stub stays an empty
  // input — it is an existing file, and the skeleton is fresh-install only.
  const effectiveExisting = existing === null ? skeleton : existing === templateBody ? "" : existing;
  return spliceManagedSections(effectiveExisting, [{ id: CLAUDE_MD_SECTION_ID, body: templateBody } satisfies ManagedSection]);
}

/**
 * Classifies the repo-root `CLAUDE.md` stub (SPEC-076 D7, migrated off
 * SPEC-060 D4's blanket backup-then-overwrite) — NEVER writes to disk
 * itself. Candidate content is computed by `computeClaudeMdSplice` — see
 * that function's doc comment for the full decision tree.
 */
async function runClaudeMdStep(
  deps: ProjectScaffoldFlowDeps,
  repoDir: string,
): Promise<{ terminal?: SimpleStepResult; pending?: AssetFile }> {
  const targetAbsPath = join(repoDir, CLAUDE_MD_TARGET_NAME);
  try {
    const assetResult = await deps.assets.readAsset(CLAUDE_MD_ASSET_NAME);
    if (!assetResult.ok) {
      return { terminal: { status: "failed", detail: describeError(assetResult.error) } };
    }
    const template = assetResult.value;
    const existing = deps.fs.readFile(targetAbsPath);
    let skeleton = "";
    if (existing === null) {
      const skeletonResult = await deps.assets.readAsset(CLAUDE_MD_SKELETON_ASSET_NAME);
      if (!skeletonResult.ok) {
        return { terminal: { status: "failed", detail: describeError(skeletonResult.error) } };
      }
      skeleton = skeletonResult.value;
    }
    const spliced = computeClaudeMdSplice(existing, template, skeleton);
    if (!spliced.ok) {
      return { terminal: { status: "failed", detail: describeError(spliced.error) } };
    }
    const content = spliced.value.content;
    return {
      pending: { path: CLAUDE_MD_TARGET_NAME, kind: PROJECT_ASSET_KIND, content, sha256: sha256Hex(content) },
    };
  } catch (error) {
    return { terminal: { status: "failed", detail: toMessage(error) } };
  }
}

/**
 * Adoption step (spec-claude-md-root-section-structure-check-and-adoption-mode D4):
 * judges the POST-SPLICE root `CLAUDE.md` content with the SOLE composition entry
 * `runMemoryFileChecks` (every deterministic kind counts — structure AND capacity
 * AND emphasis; never the pre-splice file) and asks `deps.writeAdoptionMode` to
 * persist `enforce` (zero would-be findings) or `warn` (any). The port itself only
 * writes when the key is absent, so an explicit value is never overwritten.
 *
 * reason: budgets are the repo's REAL resolved budgets (`deps.resolveMemoryFileBudgets`)
 * with `adoption` pinned to `enforce` so `deterministic` IS the would-be finding list —
 * the default-`warn` resolution would move every finding into `advisory` and hide the
 * count from this caller. Judging against schema defaults instead would write `enforce`
 * for a repo whose tighter ceilings `status --check-claude-md` then fails on.
 * References are judged too (`deps.resolveReferenceContext` supplies the target repo's probe
 * and fragments), so the mode written is the mode `lore status --check-claude-md` will
 * agree with; `docExists` is `() => true` (slug pointers are `--check-memory-pointers`'s job).
 *
 * A missing port is a loud `skipped` row (never an absent one); a budget-resolution
 * failure is a `failed` row and the write port is NOT called.
 */
function runAdoptionStep(deps: ProjectScaffoldFlowDeps, repoDir: string, postSpliceContent: string): AdoptionStepResult {
  const { writeAdoptionMode, resolveMemoryFileBudgets, resolveReferenceContext } = deps;
  if (writeAdoptionMode === undefined || resolveMemoryFileBudgets === undefined || resolveReferenceContext === undefined) {
    const missing = [
      ...(writeAdoptionMode === undefined ? ["writeAdoptionMode"] : []),
      ...(resolveMemoryFileBudgets === undefined ? ["resolveMemoryFileBudgets"] : []),
      ...(resolveReferenceContext === undefined ? ["resolveReferenceContext"] : []),
    ];
    return { status: "skipped", detail: `adoption not judged: deps.${missing.join(" and deps.")} not injected`, checklist: [] };
  }
  const resolved = resolveMemoryFileBudgets(repoDir);
  if (!resolved.ok) return { status: "failed", detail: describeError(resolved.error), checklist: [] };
  const budgets = { ...resolved.value, adoption: "enforce" as const };
  const { deterministic } = runMemoryFileChecks(
    [{ path: CLAUDE_MD_TARGET_NAME, role: "root", content: postSpliceContent }],
    budgets,
    { ...resolveReferenceContext(repoDir), docExists: () => true },
  );
  const mode: AdoptionMode = deterministic.length === 0 ? "enforce" : "warn";
  const checklist = mode === "warn" ? deterministic.map((finding) => finding.message) : [];
  const written = writeAdoptionMode(repoDir, mode);
  if (!written.ok) return { status: "failed", mode, detail: describeError(written.error), checklist };
  if (written.value.status === "kept") return { status: "kept", mode, detail: written.value.existing, checklist: [] };
  return { status: "written", mode, checklist };
}

/** Finalizes the gitignore candidate's report row once the seam has run — keys off `seam.written` (see module doc). */
function finalizeGitignoreRow(seam: ManifestSeamResult): SimpleStepResult {
  const failure = seam.failed.get(GITIGNORE_TARGET_NAME);
  if (failure !== undefined) return { status: "failed", detail: failure };
  return { status: seam.written.has(GITIGNORE_TARGET_NAME) ? "done" : "skipped", detail: GITIGNORE_TARGET_NAME };
}

/** Finalizes the CLAUDE.md candidate's report row once the seam has run — keys off `seam.written` (see module doc). */
function finalizeClaudeMdRow(seam: ManifestSeamResult): SimpleStepResult {
  const failure = seam.failed.get(CLAUDE_MD_TARGET_NAME);
  if (failure !== undefined) return { status: "failed", detail: failure };
  return { status: seam.written.has(CLAUDE_MD_TARGET_NAME) ? "done" : "skipped", detail: CLAUDE_MD_TARGET_NAME };
}

/** Where the lore-baseline skill files are installed: `<repo>/.claude/<asset path>`. */
export const SKILL_TARGET_PREFIX = ".claude/";

/**
 * BL-8 — turns every shipped `skills/lore-baseline/**` file into a ledger candidate at `.claude/<path>` (kind `skill`).
 * NEVER writes itself (writing is {@link runManifestWriteSeam}'s job); a listing failure is a terminal `failed` row.
 */
function runSkillsStep(deps: ProjectScaffoldFlowDeps): { terminal?: SimpleStepResult; candidates: AssetFile[] } {
  if (deps.skillAssets === undefined) return { candidates: [] };
  try {
    const listed = deps.skillAssets.listSkillAssets();
    if (!listed.ok) return { terminal: { status: "failed", detail: describeError(listed.error) }, candidates: [] };
    const candidates = listed.value.map(
      (asset): AssetFile => ({
        path: `${SKILL_TARGET_PREFIX}${asset.path}`,
        kind: "skill",
        content: asset.content,
        sha256: sha256Hex(asset.content),
      }),
    );
    return { candidates };
  } catch (error) {
    return { terminal: { status: "failed", detail: toMessage(error) }, candidates: [] };
  }
}

/** Finalizes the skills row once the seam has run: failed if any file failed, done if any was written, else skipped. */
function finalizeSkillsRow(candidates: AssetFile[], seam: ManifestSeamResult): SimpleStepResult {
  const failedFiles = candidates.filter((c) => seam.failed.has(c.path));
  if (failedFiles.length > 0) {
    return { status: "failed", detail: failedFiles.map((c) => `${c.path}: ${seam.failed.get(c.path)}`).join("; ") };
  }
  const writtenCount = candidates.filter((c) => seam.written.has(c.path)).length;
  return writtenCount > 0
    ? { status: "done", detail: `${writtenCount} of ${candidates.length} file(s) written` }
    : { status: "skipped", detail: `${candidates.length} file(s) already up to date` };
}

/** BL-8 — runs the injected ac-cite mode seed; `undefined` when the port is absent. */
async function runAcCiteSeedStep(deps: ProjectScaffoldFlowDeps, repoDir: string): Promise<SimpleStepResult | undefined> {
  if (deps.seedAcCiteMode === undefined) return undefined;
  const seeded = await deps.seedAcCiteMode(repoDir);
  if (!seeded.ok) return { status: "failed", detail: describeError(seeded.error) };
  return seeded.value.status === "written"
    ? { status: "done", detail: "workflow.gates.ac-cite.mode: report" }
    : { status: "skipped", detail: `kept existing mode ${seeded.value.existing}` };
}

/** A refusal naming the git version when it cannot run the `reference-transaction` hook; `undefined` when it can. */
async function checkGitSupportsMainRefHook(deps: ProjectScaffoldFlowDeps, repoDir: string): Promise<LoreError | undefined> {
  const { major, minor } = MIN_GIT_FOR_MAIN_REF_HOOK;
  const needed = `${major}.${minor}`;
  const result = await deps.exec.run(["git", "--version"], repoDir);
  const version = result.code === 0 ? parseGitVersion(result.stdout) : undefined;
  if (version === undefined) {
    return {
      code: "VALIDATION_ERROR",
      field: "git",
      message: `lore setup --project needs git >= ${needed} (the main-ref guard is a reference-transaction hook) but could not read the installed version from \`git --version\` (exit ${result.code}: ${(result.stdout + result.stderr).trim() || "no output"}).`,
    };
  }
  if (version.major > major || (version.major === major && version.minor >= minor)) return undefined;
  return {
    code: "VALIDATION_ERROR",
    field: "git",
    message: `lore setup --project refuses: ${version.raw} is older than git ${needed}, which the reference-transaction hook (the guard that keeps main moving only through lore integrate) needs. Upgrade git to ${needed} or newer and re-run.`,
    value: version.raw,
  };
}

/**
 * The `core.hooksPath` value setup writes: the ABSOLUTE path of `<repoDir>/hooks`.
 *
 * Why absolute (INT-T8, measured on git 2.50): git resolves a RELATIVE hooksPath
 * against each working tree, so with `hooks/` untracked a linked worktree has no
 * `hooks/` and runs no hook (the main-ref guard and pre-push silently do not run
 * there). An absolute path is shared by every worktree of the repo, needs no
 * tracked `hooks/`, and lives in the untracked `.git/config`.
 */
export function absoluteHooksPath(repoDir: string): string {
  return join(resolve(repoDir), "hooks");
}

/**
 * Read-modify-write of the project ledger (`.lore/.lore-project-manifest.json`) by a step that runs after the
 * manifest write seam — the rules files, the hooks setting and the language key all land outside the seam, yet
 * the uninstall reverses ledger entries only (BR-840). `update` receives the parsed ledger and returns the new one.
 *
 * @param fs - the project fs port.
 * @param repoDir - absolute repo root.
 * @param update - pure ledger transform.
 * @returns `ok(undefined)` once written; `err(VALIDATION_ERROR)` when the ledger is absent or malformed (nothing is
 *   written — a change that cannot be recorded must not be made); `err(STORE_ERROR)` when the write throws.
 * @example
 * recordInProjectLedger(fs, repoDir, (m) => ({ ...m, project_priors: { hooks_path: { prior: null } } }));
 */
export function recordInProjectLedger(
  fs: ProjectFsPort,
  repoDir: string,
  update: (ledger: SetupManifest) => SetupManifest,
): Result<void, LoreError> {
  const ledgerPath = join(repoDir, PROJECT_MANIFEST_RELATIVE_PATH);
  const raw = fs.readFile(ledgerPath);
  if (raw === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `no project install ledger at "${ledgerPath}" — a change that cannot be recorded for uninstall is not made`,
      value: ledgerPath,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return err({ code: "VALIDATION_ERROR", field: "manifest", message: `project install ledger "${ledgerPath}" is not valid JSON: ${toMessage(cause)}`, value: ledgerPath });
  }
  const current = setupManifestSchema.safeParse(parsed);
  if (!current.success) {
    return err({ code: "VALIDATION_ERROR", field: "manifest", message: `project install ledger "${ledgerPath}" failed schema validation: ${current.error.message}`, value: ledgerPath });
  }
  const next = setupManifestSchema.safeParse(update(current.data));
  if (!next.success) {
    return err({ code: "VALIDATION_ERROR", field: "manifest", message: `updated project install ledger failed schema validation: ${next.error.message}`, value: ledgerPath });
  }
  try {
    fs.writeFile(ledgerPath, `${JSON.stringify(next.data, null, 2)}\n`, 0o644);
  } catch (cause) {
    return err({ code: "STORE_ERROR", message: `writing the project install ledger "${ledgerPath}" failed: ${toMessage(cause)}`, ...(cause instanceof Error ? { cause } : {}) });
  }
  return ok(undefined);
}

/** One lore rules file the fragment refresh reported: repo-relative POSIX `path` and what the refresh did to it. */
export interface ProjectRulesFileOutcome {
  path: string;
  state: "created" | "updated" | "unchanged" | "diverged_skip" | "pruned";
}

/**
 * Records the lore rules files (`.claude/rules/lore-*.md`) the project setup wrote as ledger entries, so the project
 * uninstall removes exactly those and nothing else (BR-834 / BR-845). A created, updated or unchanged file is lore's
 * (its content is the fingerprinted render) and gets an entry; a pruned one loses its entry; a hand-edited
 * (`diverged_skip`) one is left as the ledger already had it. A file the user owns never gets an entry.
 *
 * @returns `ok(undefined)`, or the ledger error from {@link recordInProjectLedger}.
 */
export function recordProjectRulesFiles(
  fs: ProjectFsPort,
  repoDir: string,
  outcomes: readonly ProjectRulesFileOutcome[],
  now: () => string = defaultNow,
): Result<void, LoreError> {
  const nowIso = now();
  return recordInProjectLedger(fs, repoDir, (ledger) => {
    let entries = ledger.entries;
    for (const outcome of outcomes) {
      if (outcome.state === "diverged_skip") continue;
      const others = entries.filter((e) => e.path !== outcome.path);
      if (outcome.state === "pruned") {
        entries = others;
        continue;
      }
      const content = fs.readFile(join(repoDir, outcome.path));
      if (content === null) {
        entries = others;
        continue;
      }
      const previous = entries.find((e) => e.path === outcome.path);
      entries = [
        ...others,
        {
          path: outcome.path,
          kind: "governance",
          sha256: sha256Hex(content),
          written_at: previous?.written_at ?? nowIso,
          ownership: "managed",
        },
      ];
    }
    return { ...ledger, entries };
  });
}

/**
 * Records, BEFORE the setup writes `language` into a project settings file, what that file held (BR-834 / BR-845):
 * whether the file and the key existed and the key's value. The FIRST recording wins — a re-run sees lore's own
 * value and must not replace the user's original. A settings file that is not a JSON object is not recorded (the
 * language write refuses it and nothing changes, so there is nothing to restore).
 *
 * @param settingsRelPath - repo-relative POSIX path of the settings file.
 */
export function recordProjectLanguagePrior(fs: ProjectFsPort, repoDir: string, settingsRelPath: string): Result<void, LoreError> {
  const raw = fs.readFile(join(repoDir, settingsRelPath));
  let hadKey = false;
  let prior: unknown;
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return ok(undefined);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return ok(undefined);
    const settings = parsed as Record<string, unknown>;
    hadKey = Object.hasOwn(settings, "language");
    prior = settings["language"];
  }
  return recordInProjectLedger(fs, repoDir, (ledger) => {
    const rows = ledger.project_priors?.settings_language ?? [];
    if (rows.some((row) => row.path === settingsRelPath)) return ledger;
    return {
      ...ledger,
      project_priors: {
        ...ledger.project_priors,
        settings_language: [...rows, { path: settingsRelPath, file_existed: raw !== null, had_key: hadKey, prior }],
      },
    };
  });
}

async function runGitHooksPathStep(deps: ProjectScaffoldFlowDeps, repoDir: string): Promise<GitHooksPathResult> {
  try {
    const target = absoluteHooksPath(repoDir);
    const getResult = await deps.exec.run(["git", "config", "--get", "core.hooksPath"], repoDir);
    const priorValue = getResult.code === 0 ? getResult.stdout.trim() : null;

    // reason: the ledger records the FIRST earlier value and keeps it on every re-run — a second run sees our own
    // absolute path as "prior" and would overwrite the user's real original. Recorded BEFORE the write: a crash
    // between the two leaves a restorable ledger rather than an unrecorded change (BR-837).
    const recorded = recordInProjectLedger(deps.fs, repoDir, (ledger) => ({
      ...ledger,
      project_priors: {
        ...ledger.project_priors,
        hooks_path: ledger.project_priors?.hooks_path ?? { prior: priorValue },
      },
    }));
    if (!recorded.ok) return { status: "failed", prior_value: priorValue, detail: describeError(recorded.error) };

    if (priorValue === target) {
      return { status: "skipped", prior_value: priorValue };
    }

    const setResult = await deps.exec.run(["git", "config", "core.hooksPath", target], repoDir);
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
 * written from template (skipped if already present), a repo-root
 * `.gitignore` append (SPEC-060 D3), a repo-root `CLAUDE.md` marker-section
 * rewrite stub (SPEC-076 D7), and `git config core.hooksPath hooks` wired
 * via the injected {@link ExecPort}. SPEC-060 D1 additionally records every
 * hooks/tree_yaml/gitignore/claude_md write into a repo-local ledger at
 * `.lore/.lore-project-manifest.json` via {@link runManifestWriteSeam} — see
 * this module's top-level doc comment.
 *
 * All six scaffold steps run UNCONDITIONALLY and INDEPENDENTLY of each
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

  // reason: checked BEFORE any write — the main-ref hook is part of the scaffold and git < 2.28 cannot run it, so a
  // scaffold that installed everything else would leave main unguarded while looking set up (BR-1246).
  const gitVersionRefusal = await checkGitSupportsMainRefHook(deps, repoDir);
  if (gitVersionRefusal !== undefined) return err(gitVersionRefusal);

  const init = await runInitStep(deps, repoDir);

  const hooksOutcome = await runHooksStep(deps, repoDir);
  const treeYamlOutcome = await runTreeYamlStep(deps, repoDir);
  const gitignoreOutcome = await runGitignoreStep(deps, repoDir);
  const claudeMdOutcome = await runClaudeMdStep(deps, repoDir);
  const skillsOutcome = runSkillsStep(deps);

  const candidates: AssetFile[] = [
    ...hooksOutcome.pending.map((p) => p.candidate),
    ...(treeYamlOutcome.pending ? [treeYamlOutcome.pending.candidate] : []),
    ...(gitignoreOutcome.pending ? [gitignoreOutcome.pending] : []),
    ...(claudeMdOutcome.pending ? [claudeMdOutcome.pending] : []),
    ...skillsOutcome.candidates,
  ];
  const managedPaths = new Set<string>([
    ...skillsOutcome.candidates.map((c) => c.path),
    ...HOOK_ASSET_NAMES.map((name) => `hooks/${name}`),
    TREE_TEMPLATE_TARGET_NAME,
    GITIGNORE_TARGET_NAME,
    CLAUDE_MD_TARGET_NAME,
  ]);

  const seam = await runManifestWriteSeam(deps, repoDir, candidates, managedPaths, now);

  const hooks: HookFileResult[] = [
    ...hooksOutcome.terminal,
    ...hooksOutcome.pending.map(({ file, wasMissing }) => finalizeHookRow(file, wasMissing, seam.failed)),
  ];

  const tree_yaml: SimpleStepResult = treeYamlOutcome.terminal
    ? treeYamlOutcome.terminal
    : finalizeTreeYamlRow(treeYamlOutcome.pending!.wasMissing, seam.failed);

  const gitignore: SimpleStepResult = gitignoreOutcome.terminal ?? finalizeGitignoreRow(seam);
  const claude_md: SimpleStepResult = claudeMdOutcome.terminal ?? finalizeClaudeMdRow(seam);

  const git_hooks_path = await runGitHooksPathStep(deps, repoDir);

  const skills: SimpleStepResult | undefined =
    deps.skillAssets === undefined ? undefined : (skillsOutcome.terminal ?? finalizeSkillsRow(skillsOutcome.candidates, seam));
  const ac_cite = await runAcCiteSeedStep(deps, repoDir);

  // Judged only when the CLAUDE.md step produced a candidate (a failed step has no content to judge).
  const adoption =
    claudeMdOutcome.pending === undefined ? undefined : runAdoptionStep(deps, repoDir, claudeMdOutcome.pending.content);

  return ok({
    init,
    hooks,
    tree_yaml,
    gitignore,
    claude_md,
    git_hooks_path,
    ...(adoption === undefined ? {} : { adoption }),
    ...(skills === undefined ? {} : { skills }),
    ...(ac_cite === undefined ? {} : { ac_cite }),
    manifest: seam.manifestStatus,
    backups: seam.backups,
  });
}
