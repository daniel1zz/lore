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
 * Public surface:
 *   ProjectFsPort        — the narrow fs port (exists/readFile/writeFile/mkdir)
 *   ExecPort              — the narrow process-exec port (used for `git config`)
 *   InitCorpus            — the `.lore/` bootstrap thunk, PROVIDED BY THE ADAPTER
 *                           (wraps the same logic `commands/init.ts` runs — never
 *                           imported directly here, so this module never
 *                           constructs a `CorpusService`/`App` itself)
 *   ProjectAssetSource    — reads one named `assets/project/*` file by filename
 *   ProjectScaffoldFlowDeps — the four ports above, bundled
 *   ProjectScaffoldOptions  — `{ repoDir }`, the per-call target repo
 *   ProjectScaffoldReport   — the full per-step outcome report
 *   scaffoldProject(deps, opts) — runs all four steps, always returns `ok`
 *     with a report UNLESS `opts.repoDir` itself is malformed (top-level `err`)
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
 *     scaffoldable repo).
 *   - Idempotent by design: a target already carrying the exact shipped bytes
 *     is `skipped`, never rewritten; a `.lore/` directory that already exists
 *     short-circuits `initCorpus` entirely (it is never called on a re-run).
 *   - Conflict, not clobber: a hooks/* file that exists with DIFFERENT content
 *     than the shipped asset is reported `conflict` and left byte-for-byte
 *     untouched — repo hooks may be user-customized (SPEC-046 §Design). This
 *     conflict check applies ONLY to the hooks step; `lore.tree.yaml` uses the
 *     simpler "present → skipped" rule the spec literally describes (no
 *     content diff), since a project's tree blueprint is expected to diverge
 *     from the template immediately after first scaffold.
 *   - `scaffoldProject` itself never throws and never rejects — every
 *     failure mode surfaces as either a step-level `"failed"`/`"conflict"`
 *     status inside the returned report, or (for a malformed `repoDir` only)
 *     a top-level `err(VALIDATION_ERROR)`.
 *
 * Side-effect class: IO (delegates entirely to the injected ports)
 * Source: SPEC-046 §Design, §Scope; task AC-046-C
 */

import { join } from "node:path";
import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Renders a thrown value's message for a step's `detail` field. Never throws. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Renders a `LoreError` for a step's `detail` field. Never throws. */
function describeError(error: LoreError): string {
  return JSON.stringify(error);
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

async function runHooksStep(deps: ProjectScaffoldFlowDeps, repoDir: string): Promise<HookFileResult[]> {
  const hooksDir = join(repoDir, "hooks");
  const results: HookFileResult[] = [];

  for (const name of HOOK_ASSET_NAMES) {
    const targetRelPath = `hooks/${name}`;
    const targetAbsPath = join(hooksDir, name);
    try {
      const assetResult = await deps.assets.readAsset(name);
      if (!assetResult.ok) {
        results.push({ file: targetRelPath, status: "failed", detail: describeError(assetResult.error) });
        continue;
      }
      const content = assetResult.value;
      const existing = deps.fs.readFile(targetAbsPath);

      if (existing === null) {
        deps.fs.mkdir(hooksDir);
        deps.fs.writeFile(targetAbsPath, content, HOOK_FILE_MODE);
        results.push({ file: targetRelPath, status: "done" });
      } else if (existing === content) {
        results.push({ file: targetRelPath, status: "skipped" });
      } else {
        results.push({
          file: targetRelPath,
          status: "conflict",
          detail: "existing file differs from the shipped asset — left untouched",
        });
      }
    } catch (error) {
      results.push({ file: targetRelPath, status: "failed", detail: toMessage(error) });
    }
  }

  return results;
}

async function runTreeYamlStep(deps: ProjectScaffoldFlowDeps, repoDir: string): Promise<SimpleStepResult> {
  const targetAbsPath = join(repoDir, TREE_TEMPLATE_TARGET_NAME);
  try {
    if (deps.fs.exists(targetAbsPath)) {
      return { status: "skipped", detail: TREE_TEMPLATE_TARGET_NAME };
    }
    const assetResult = await deps.assets.readAsset(TREE_TEMPLATE_ASSET_NAME);
    if (!assetResult.ok) {
      return { status: "failed", detail: describeError(assetResult.error) };
    }
    deps.fs.writeFile(targetAbsPath, assetResult.value, TREE_YAML_MODE);
    return { status: "done", detail: TREE_TEMPLATE_TARGET_NAME };
  } catch (error) {
    return { status: "failed", detail: toMessage(error) };
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
 *
 * All four steps run UNCONDITIONALLY and INDEPENDENTLY of each other's
 * outcome — a failure in one step never prevents the remaining steps from
 * being attempted (see module invariants). The function itself only ever
 * returns a top-level `err` for a structurally invalid `opts.repoDir`; every
 * IO failure is instead captured as a `"failed"`/`"conflict"` status inside
 * the returned report.
 *
 * @param deps - The four narrow ports (fs/exec/initCorpus/assets), adapter-provided.
 * @param opts - `{ repoDir }` — the absolute path to the target repo root.
 * @returns `ok(report)` with the full per-step outcome, or
 *   `err(VALIDATION_ERROR)` when `repoDir` is not a non-empty absolute path.
 * @example
 * const result = await scaffoldProject(deps, { repoDir: "/path/to/repo" });
 * if (result.ok) console.log(result.value.git_hooks_path.status);
 */
export async function scaffoldProject(
  deps: ProjectScaffoldFlowDeps,
  opts: ProjectScaffoldOptions,
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
  const hooks = await runHooksStep(deps, repoDir);
  const tree_yaml = await runTreeYamlStep(deps, repoDir);
  const git_hooks_path = await runGitHooksPathStep(deps, repoDir);

  return ok({ init, hooks, tree_yaml, git_hooks_path });
}
