/**
 * lore setup [--dry-run] [--uninstall] [--project] [--check] [--claude-dir <path>] [--force-diverged] [--yes] [--json]
 *
 * `--force-diverged` (SPEC-076 §C3 D2, task
 * task-skill-implement-t5-converge-hardening-diverged-skip-force) — install/
 * converge mode only. On the UPDATE path (an installed manifest already
 * exists — a fresh install has no "diverged" concept at all), a managed
 * file whose on-disk bytes have been user-edited since the last converge is,
 * by default, left UNTOUCHED and reported via the receipt's
 * `skippedDiverged` list (plus a `lore setup --yes --force-diverged` repair
 * line per path, non-JSON mode). Passing this flag overrides that default:
 * every diverged path is backed up (same `.lore-backups` mechanism as an
 * `outdated` file) and overwritten instead. Mutually exclusive with
 * `--check` (a read-only projection has no write-time override to make;
 * checked alongside `--uninstall`/`--dry-run` in the same early mutex).
 *
 * Thin CLI adapter wiring `SetupService` (global machine install into a
 * Claude Code config directory, conventionally `~/.claude`) and
 * `ProjectSetupService` (per-repo project scaffold, `--project`) to real,
 * `node:fs`/`node:child_process`-backed ports (`RealAssetSource`,
 * `RealSetupFsReader`/`RealSetupFsWriter`, `RealMcpRegistrar`) — the FINAL
 * SPEC-046 wiring task, connecting every previously-merged service/port/
 * renderer into a reachable CLI verb (SPEC-046 §Design, task AC-046-E).
 *
 * `--check` (SPEC-076 §C3, task task-skill-implement-t4-lore-setup-check-read-only-projection,
 * AC-076-2) is a FULLY SEPARATE, READ-ONLY dispatch — handled at the very top
 * of `run()`, before `validateSetupFlags`'s `SetupMode` resolution even runs,
 * since it composes with NONE of install/dry-run/uninstall/project's modes
 * (mutually exclusive with `--uninstall`/`--dry-run`/`--force-diverged`, each
 * refused exit 2 naming it; BR-849). `--check --project` (BR-1085) checks the
 * PROJECT install instead of the global one — `runProjectCheck` below
 * classifies ledger hooks/skills, lore rules files and project settings
 * entries and writes only the project check cache; it skips the GitHub-channel
 * probe (a machine-level concern).
 * Thin pipe over `../setup-check.js::runSetupCheck`/`computeSetupCheckReport`
 * — see that module's own doc for the zero-mutation-beyond-the-check-cache
 * invariant. Immediately after that asset-freshness section, `--check` ALSO
 * runs a second, independent read-only section (task
 * task-skill-implement-lore-setup-check-read-only-health-probe, AC-GI-2's
 * pre-flight discoverability half, Migration Plan P0) — a GitHub-channel
 * health probe over `../setup-github-health.js::runGitHubHealthCheck`,
 * wired here via `runGitHubChannelHealthCheck` below. It never touches any
 * file the asset-freshness section reads or writes, and never downgrades
 * an already-nonzero exit code from that section — see
 * `runGitHubChannelHealthCheck`'s own doc.
 *
 * `--check --json` composition (2026-08-24 fix): the two sections above are
 * two SEPARATE reports, but `--json` MUST print exactly ONE top-level JSON
 * document — printing each report via its own `console.log` (the pre-fix
 * behavior) emits two, which is not valid JSON to any `JSON.parse(stdout)`
 * consumer (measured: 9 bun tests red). `runCheckDispatch` below is the
 * ONLY caller of both sections now: in `--json` mode it computes the
 * freshness report via `computeSetupCheckReport` (which never prints) and
 * the channel report via `runGitHubHealthCheck` (never printed anything
 * itself), then prints ONE `console.log(JSON.stringify({ ok, data: {
 * ...report, github_channel: channelReport } }))` — the channel report is
 * reachable at `data.github_channel`, never a second document. The HUMAN
 * (non-`--json`) path is untouched: it still calls `runSetupCheck`
 * (prints its own rendered section) followed by `runGitHubChannelHealthCheck`
 * (prints its own `✓`/`✗` line) exactly as before this fix — two sections on
 * a human terminal were always fine; two JSON values on one stdout stream
 * never were.
 *
 * `--project --uninstall` (SPEC-060 §Design D2) is a FIFTH mode
 * (`"project-uninstall"`, `../setup-args.js::SetupMode`) reversing a prior
 * `--project` scaffold via its OWN repo-level install ledger
 * (`.lore/.lore-project-manifest.json`) — a thin pipe over
 * `../../../flows/setup-project-uninstall.js::uninstallProject`, never
 * `SetupService` (that class's own `--uninstall`, without `--project`,
 * reverses the SEPARATE global `~/.claude` installer).
 *
 * Deliberately does NOT go through `loadLoreApp()` (unlike almost every other
 * command in this directory) — mirrors `commands/init.ts`'s bootstrap-stage
 * exemption (`loader.ts`'s own header doc). The global install path has
 * nothing to do with any `.lore/` corpus (it targets `~/.claude`, unrelated
 * to `process.cwd()`); the `--project` path DOES eventually bootstrap a
 * `.lore/` corpus, but via the injected `initCorpus` thunk
 * (`../../../flows/init-corpus.js::initCorpusAt`), never via `loadLoreApp()`
 * (which requires a `.lore/lore.db` to ALREADY exist — the opposite of what
 * `--project` is scaffolding).
 *
 * Target directory resolution (SPEC-046 §Design, "in the ADAPTER"):
 *   `--claude-dir <path>` > `$CLAUDE_CONFIG_DIR` > `join(currentHomeDir(), ".claude")`
 *   — see `../setup-args.js::resolveTargetDir` (the ONLY `os.homedir()` call
 *   site in this command).
 *
 * binPath / assetsRoot resolution — see `../setup-args.js`'s module doc for
 * the full empirically-verified compiled-vs-dev-mode resolution chain
 * (`Bun.main`'s `/$bunfs/` prefix, NOT `Bun.isStandaloneExecutable` — absent
 * from this repo's pinned Bun/bun-types).
 *
 * Real-target guard (`SetupService.assertSafeTargetDir`) — this adapter
 * ALWAYS sets `LORE_SETUP_ALLOW_REAL=1` before any service call (see the
 * `// reason:` comment at that call site below) — the guard's job is to stop
 * a test that constructs `SetupService` DIRECTLY, bypassing this adapter,
 * from accidentally hitting a real `~/.claude`; any invocation that reaches
 * this adapter is a genuine (or deliberately, realistically simulated —
 * `HOME` overridden to a throwaway dir) `lore setup` intent.
 *
 * Confirm prompt (mirrors `commands/verify.ts`'s SPEC-039 §M2 y/N precedent):
 *   `--dry-run` never prompts (non-mutating). Every mutating mode
 *   (install/uninstall/`--project`/`--project --uninstall`) prompts when interactive
 *   (`process.stdin.isTTY`, no `--json`) and `--yes` was not passed; a
 *   non-`y`/`yes` answer aborts with exit 0 ("no changes made" — a
 *   deliberate, valid user choice, not a failure). Non-interactive without
 *   `--yes` aborts with exit 2, naming `--yes`. `--yes` always skips the
 *   prompt (and the preview it would have shown) and proceeds directly.
 *
 * Exit codes:
 *   0 = success (including a deliberate interactive "no" to the confirm prompt)
 *   2 = flag-conflict / non-interactive-without-`--yes` (CLI-usage errors,
 *       never a `LoreError`)
 *   1 or 4-7 = per `exitCode()` (SPEC-003 §5 SSOT) for any `LoreError` a
 *       service call returns (STORE_ERROR/manifest-schema failures → 1;
 *       malformed settings.json / unsafe targetDir / manifest validation →
 *       4; STALE_VERSION → 5 — none of `SetupService`'s public methods
 *       currently return 5/6/7, listed for completeness)
 *   1 = the run otherwise succeeded but MCP registration failed
 *       (`SetupReceipt.mcp === "failed"`) — file-asset work still completed;
 *       the rendered/JSON receipt already names the manual
 *       `claude mcp add`/`remove` recovery command (mirrors `verify.ts`'s
 *       "ran fine, one part failed" exit-1 bucket)
 *   `--check` ONLY, from its second (GitHub-channel) section, and only when
 *   the asset-freshness section reported a clean exit (see
 *   `runGitHubChannelHealthCheck`'s own doc for why it never downgrades an
 *   already-nonzero code): 8 = the CLI binary is missing or unauthenticated,
 *   1 = it is authenticated but the configured target could not be read.
 *
 * Source: SPEC-046 §Design, §Scope; task AC-046-E.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { getExitCode, setExitCode } from "../run-scope.js";
import { spawnSync } from "node:child_process";
import { resolveGlobalConfigPath } from "@lore/core/node";
import type { Invocation } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { createInterface } from "node:readline/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";
import { seedAcCiteModeAudited } from "./baseline-adopt.js";
import { parseDocument } from "yaml";
import { resolveTrackedWriteRoot } from "../working-tree-root.js";
import { err, loadConfigFromString, ok, resolveMemoryFileBudgets } from "@lore/core";
import type { AdoptionMode, FsWritePort, LoreError, MemoryFileBudgets, Result } from "@lore/core";
import { buildRefreshFragmentDeps, makeRealContextFsPort, toContextLayer } from "./context.js";
import { loadConfig, loadGlobalConfig } from "@lore/core/node";

import { SetupService, type McpAddOutcome, type McpRegistrar, type SetupReceipt } from "../../../service/setup-service.js";
import { ProjectSetupService, checkProjectLedger } from "../../../service/project-setup-service.js";
import {
  PROJECT_MANIFEST_RELATIVE_PATH,
  type ExecPort,
  type ProjectFsPort,
  type ProjectAssetSource,
  type AdoptionWriteOutcome,
  type ProjectScaffoldReport,
  type ProjectSkillAsset,
  type ProjectSkillAssetSource,
} from "../../../flows/setup-project-flow.js";
import {
  uninstallProject,
  type ProjectFsRemovePort,
  type ProjectUninstallReport,
} from "../../../flows/setup-project-uninstall.js";
import { initCorpusAt } from "../../../flows/init-corpus.js";
import { ambientOfInvocation } from "../../../app.js";
import { runContextRefresh } from "../../../flows/context-flow.js";
import { ClaudeSettingsPort, createRealClaudeSettingsFs, resolveLanguageName } from "../../claude-settings-port.js";
import { RealAssetSource } from "../../real-asset-source.js";
import { RealSetupFsReader, RealSetupFsWriter, backupProjectFile, removeProjectPath } from "../../real-setup-fs.js";
import { RealMcpRegistrar } from "../../real-mcp-registrar.js";
import {
  renderInstallPlan,
  renderInstallReceipt,
  renderProjectScaffoldReceipt,
  renderUninstallReceipt,
  PROJECT_NEXT_STEPS,
  type ProjectScaffoldReceipt,
  type SetupRenderCtx,
} from "../setup-render.js";
import {
  resolveAssetsRoot,
  resolveBinPath,
  resolveTargetDir,
  validateSetupFlags,
  type SetupPathContext,
} from "../setup-args.js";
import { exitCode, formatError, formatErrorFor } from "../utils.js";
import { computeSetupCheckReport, finishProjectSetupCheck, runSetupCheck } from "../setup-check.js";
import type { SetupCheckFiles } from "../setup-check.js";
import { createNodeGhExecFile, GhRunner } from "../../../service/gh-runner.js";
import { createGhRunnerHealthProbe, ghHealthExitCode, runGitHubHealthCheck } from "../setup-github-health.js";

// ─── Repo-root resolution (dev mode only — see setup-args.ts's module doc) ──
// packages/lore/src/adapters/cli/commands/setup.ts -> repo root is 6 levels up.

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

// ─── MCP failure-detail capture ──────────────────────────────────────────────

/**
 * Wraps a real `McpRegistrar`, remembering the last `add`/`remove` failure's
 * message so it can be threaded into `SetupRenderCtx.mcpErrorTail` — SPEC-046
 * deliberately keeps `SetupReceipt.mcp` a bare marker with no error
 * detail of its own (see `setup-render.ts`'s module doc), so the CLI adapter
 * is the one place that can hold onto the real `LoreError.message` from the
 * SAME call `SetupService` already made, without a second registration
 * attempt.
 */
class CapturingMcpRegistrar implements McpRegistrar {
  private lastErrorMessage: string | undefined;

  constructor(private readonly inner: McpRegistrar) {}

  get lastError(): string | undefined {
    return this.lastErrorMessage;
  }

  async add(binPath: string): Promise<Result<McpAddOutcome, LoreError>> {
    const result = await this.inner.add(binPath);
    if (!result.ok) this.lastErrorMessage = describeLoreError(result.error);
    return result;
  }

  async remove(): Promise<Result<void, LoreError>> {
    const result = await this.inner.remove();
    if (!result.ok) this.lastErrorMessage = describeLoreError(result.error);
    return result;
  }
}

/**
 * `LoreError` is a discriminated union — not every member carries `.message`
 * (e.g. `DOC_NOT_FOUND` carries `id`, not `message`). Mirrors `loader.ts`'s
 * own `"message" in error ? error.message : error.code` narrowing.
 */
function describeLoreError(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

function renderCtx(targetDir: string, binPath: string, mcpErrorTail: string | undefined): SetupRenderCtx {
  return { targetDir, binPath, ...(mcpErrorTail !== undefined ? { mcpErrorTail } : {}) };
}

// ─── Confirm-before-mutate (mirrors commands/verify.ts's SPEC-039 §M2 y/N) ──

type ConfirmDecision = "proceed-no-prompt" | "prompt" | "reject-noninteractive";

/** Classifies how a mutating run's confirmation should be resolved — see this file's header doc. */
function classifyConfirmation(opts: { yes: boolean; json: boolean }): ConfirmDecision {
  if (opts.yes) return "proceed-no-prompt";
  if (process.stdin.isTTY && !opts.json) return "prompt";
  return "reject-noninteractive";
}

/** Interactive y/N confirmation prompt. Any answer other than a case-insensitive "y"/"yes" is "no". */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Runs the shared confirm-before-mutate flow for one mutating mode
 * (install/uninstall/project). `preview` is printed ONLY when a prompt will
 * actually be shown (never computed/printed in the `--yes` or non-interactive
 * paths, where it would never be seen).
 *
 * @returns `true` when the caller should proceed; `false` when it already
 *   printed its own message and set `process.exitCode` (0 for a deliberate
 *   "no", 2 for the non-interactive-without-`--yes` case).
 */
async function confirmOrReport(opts: {
  yes: boolean;
  json: boolean;
  verb: string;
  preview: () => string;
}): Promise<boolean> {
  const decision = classifyConfirmation({ yes: opts.yes, json: opts.json });

  if (decision === "reject-noninteractive") {
    process.stderr.write(
      `Error: refusing to ${opts.verb} without confirmation in a non-interactive session — pass --yes.\n`,
    );
    setExitCode(2);
    return false;
  }

  if (decision === "prompt") {
    console.log(opts.preview());
    const confirmed = await promptYesNo("Proceed? [y/N] ");
    if (!confirmed) {
      console.log("Aborted — no changes made.");
      setExitCode(0);
      return false;
    }
  }

  return true;
}

// ─── --project rendering ──────────────────────────────────────────────────
// SPEC-060 D5/D6: the actual receipt is rendered by
// `../setup-render.js::renderProjectScaffoldReceipt` (shared SSOT with its
// own test suite) — this module no longer carries a second, independently
// authored text renderer for the same report shape.

function scaffoldReportFailed(report: ProjectScaffoldReport): boolean {
  return (
    report.init.status === "failed" ||
    report.tree_yaml.status === "failed" ||
    report.gitignore.status === "failed" ||
    report.claude_md.status === "failed" ||
    report.git_hooks_path.status === "failed" ||
    report.adoption?.status === "failed" ||
    report.skills?.status === "failed" ||
    report.ac_cite?.status === "failed" ||
    report.hooks.some((h) => h.status === "failed")
  );
}

/** Renders a {@link ProjectUninstallReport} — mirrors `renderScaffoldReport`'s plain-text shape. */
function renderProjectUninstallReport(repoDir: string, report: ProjectUninstallReport): string {
  const lines: string[] = [];
  lines.push(`✓ lore project scaffold uninstalled → ${repoDir}`);
  lines.push("");
  lines.push(`Restored from backup (${report.restored.length}):`);
  for (const path of report.restored) lines.push(`  ${path}`);
  lines.push("");
  lines.push(`Removed, no backup (${report.removed.length}):`);
  for (const path of report.removed) lines.push(`  ${path}`);
  lines.push("");
  lines.push(`Manifest removed: ${report.manifestPath}`);
  return lines.join("\n");
}

// ─── Real project-scaffold ports (mirrors project-setup-service.test.ts's real port builders) ──

/**
 * Real {@link ProjectFsPort} — includes `backup`/`remove` (SPEC-060 D1/D2's
 * OPTIONAL port extension, see `flows/setup-project-flow.ts`'s module doc)
 * via the standalone `backupProjectFile`/`removeProjectPath` functions
 * (`../../real-setup-fs.js`) so the D3/D4 backup-then-overwrite steps
 * (`.gitignore` append, `CLAUDE.md` overwrite) can actually back up an
 * existing file before it's replaced — without this, a `plan.backups` entry
 * with no `deps.fs.backup` implementation fails LOUD per that module's own
 * documented contract, silently degrading D4's "backup-then-overwrite" into
 * "overwrite, no recovery" the moment a real CLAUDE.md needed one.
 */
function makeRealProjectFs(): ProjectFsPort {
  return {
    exists(path: string): boolean {
      return existsSync(path);
    },
    readFile(path: string): string | null {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    },
    writeFile(path: string, content: string, mode: number): void {
      writeFileSync(path, content, { mode });
    },
    mkdir(path: string): void {
      mkdirSync(path, { recursive: true });
    },
    backup: backupProjectFile,
    remove: removeProjectPath,
  };
}

/**
 * Real {@link ProjectFsRemovePort} — `makeRealProjectFs()`'s methods,
 * narrowed to a NON-optional `remove` (SPEC-060 §Design D2,
 * `--project --uninstall`'s port requirement; see
 * `flows/setup-project-uninstall.ts`'s module header for why this is a local
 * port extension rather than a `ProjectFsPort` edit). `makeRealProjectFs()`
 * already implements `remove` via the SAME `removeProjectPath` function —
 * this wrapper exists purely to satisfy `ProjectFsRemovePort`'s stricter
 * (required, not optional) type, not to provide different behavior.
 */
function makeRealProjectRemoveFs(): ProjectFsRemovePort {
  return { ...makeRealProjectFs(), remove: removeProjectPath };
}

function makeRealProjectExec(): ExecPort {
  return {
    // reason: no explicit `maxBuffer` here (unlike `commands/assess.ts`'s `git diff`
    // spawn, task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1) — this
    // generic `run` takes ARBITRARY argv, but `ExecPort`'s OWN contract (see its
    // docstring in `../../../flows/setup-project-flow.ts`) restricts every real caller
    // to `git config --get core.hooksPath` / `git config core.hooksPath <abs>/hooks`: output
    // is always a single config value or empty, never diff-shaped or unbounded. Bounded
    // by the CALLER's narrow usage, not by this generic implementation — if a future
    // caller ever passes a command with unbounded output through this port, it needs
    // its own `maxBuffer` sizing at that point, not a preemptive one here.
    async run(argv: string[], cwd: string) {
      const [cmd, ...rest] = argv;
      if (!cmd) return { code: -1, stdout: "", stderr: "empty argv" };
      const result = spawnSync(cmd, rest, { cwd, encoding: "utf-8" });
      if (result.error) return { code: -1, stdout: "", stderr: result.error.message };
      return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}

function makeRealProjectAssetSource(projectAssetsDir: string): ProjectAssetSource {
  return {
    async readAsset(name: string): Promise<Result<string, LoreError>> {
      try {
        return ok(readFileSync(join(projectAssetsDir, name), "utf-8"));
      } catch (cause) {
        return err({
          code: "VALIDATION_ERROR",
          field: "name",
          message: `unknown or unreadable project asset "${name}" under ${projectAssetsDir}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          value: name,
        });
      }
    },
  };
}

/** The consumer skill whose files `lore setup --project` installs into `.claude/` (assets SSOT: `assets/skills/<name>/**`). */
const BASELINE_SKILL_DIRNAME = "lore-baseline";

/**
 * Real {@link ProjectSkillAssetSource}: every file under `<assetsRoot>/skills/lore-baseline/` (recursive, sorted,
 * paths relative to the assets root with `/` separators). A missing or empty tree is an error, never an empty list.
 */
function makeRealProjectSkillSource(assetsRoot: string): ProjectSkillAssetSource {
  return {
    listSkillAssets(): Result<ProjectSkillAsset[], LoreError> {
      const rel = `skills/${BASELINE_SKILL_DIRNAME}`;
      const collected: ProjectSkillAsset[] = [];
      const walk = (relDir: string): void => {
        for (const entry of readdirSync(join(assetsRoot, relDir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const relPath = `${relDir}/${entry.name}`;
          if (entry.isDirectory()) walk(relPath);
          else if (entry.isFile()) collected.push({ path: relPath, content: readFileSync(join(assetsRoot, relPath), "utf-8") });
        }
      };
      try {
        walk(rel);
      } catch (cause) {
        return err({
          code: "VALIDATION_ERROR",
          field: "skills",
          message: `cannot read the ${rel} assets under ${assetsRoot}: ${cause instanceof Error ? cause.message : String(cause)}`,
          value: rel,
        });
      }
      if (collected.length === 0) {
        return err({ code: "VALIDATION_ERROR", field: "skills", message: `no files under ${join(assetsRoot, rel)}`, value: rel });
      }
      return ok(collected);
    },
  };
}

// ─── Mode handlers ────────────────────────────────────────────────────────────

/**
 * The recommended verification-profile overlay asset name (SPEC-058 §Design
 * Decisions D6) — sits alongside `TREE_TEMPLATE_ASSET_NAME`'s equivalent role
 * in `setup-project-flow.ts`, but is read HERE (not as a `scaffoldProject`
 * step) because it seeds `initCorpusAt`'s `configTemplateYaml` option rather
 * than being copied verbatim to a target path.
 */
const CONFIG_TEMPLATE_ASSET_NAME = "lore-config-template.yaml";

/**
 * Real `ResolveMemoryFileBudgets` port: the target repo's own resolved
 * `context.memory_files` budgets from its `.lore/config.yaml` (the init step has
 * already created it), so the adoption judgement uses the ceilings
 * `status --check-claude-md` will enforce. A load failure is returned, never defaulted.
 *
 * @param repoDir - Absolute repo root.
 */
function resolveRepoMemoryFileBudgets(repoDir: string): Result<MemoryFileBudgets, LoreError> {
  const loaded = loadConfig(repoDir);
  if (!loaded.ok) return loaded;
  return ok(resolveMemoryFileBudgets(loaded.value));
}

/**
 * Real `WriteAdoptionMode` port (spec-claude-md-root-section-structure-check-and-adoption-mode D4):
 * adds `context.memory_files.adoption` to the repo's `.lore/config.yaml` ONLY when it is
 * absent — an explicit value (either mode) is never overwritten and the file is left
 * byte-identical. The edit is applied to the RAW text via the `yaml` Document API, so
 * ONLY that one key is added (no parsed+defaulted config is round-tripped, hence no
 * default budgets are frozen into the file) and comments / key order survive. The edited
 * text is validated with `loadConfigFromString` BEFORE it is written (fail loud).
 *
 * @param repoDir - Absolute repo root.
 * @param mode - Mode judged on the post-splice CLAUDE.md.
 * @returns `err` when the config cannot be read/parsed/validated or written (surfaced, never swallowed).
 */
function writeAdoptionModeToConfig(repoDir: string, mode: AdoptionMode): Result<AdoptionWriteOutcome, LoreError> {
  // reason: loadConfig first — an already-invalid config is refused with its own validation error.
  const loaded = loadConfig(repoDir);
  if (!loaded.ok) return loaded;
  const path = join(repoDir, ".lore", "config.yaml");
  const storeError = (message: string, cause: unknown): LoreError => ({
    code: "STORE_ERROR",
    message,
    ...(cause instanceof Error ? { cause } : {}),
  });
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return err(storeError(`Failed to read ${path}`, e));
  }
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    return err(storeError(`Failed to parse ${path}: ${doc.errors[0]?.message ?? "unknown"}`, doc.errors[0]));
  }
  const existing = doc.getIn(["context", "memory_files", "adoption"]);
  if (existing === "enforce" || existing === "warn") return ok({ status: "kept", existing });
  if (existing !== undefined && existing !== null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "context.memory_files.adoption",
      message: `${path}: context.memory_files.adoption has an unsupported value; expected "enforce" or "warn"`,
      value: existing,
    });
  }
  try {
    doc.setIn(["context", "memory_files", "adoption"], mode);
  } catch (e) {
    return err(storeError(`Cannot add context.memory_files.adoption to ${path}`, e));
  }
  const edited = doc.toString();
  const validated = loadConfigFromString(edited);
  if (!validated.ok) return validated;
  try {
    writeFileSync(path, edited, "utf8");
  } catch (e) {
    return err(storeError(`Failed to write ${path}`, e));
  }
  return ok({ status: "written" });
}

// ─── context.language projection (spec-context-fragments D3; AC-CF-5, AC-CF-18) ──

/** One resolved `context.language` -> Claude Code `language` write. */
interface LanguageProjection {
  readonly layer: "global" | "project";
  /** Absolute path of the Claude Code settings file receiving `language`. */
  readonly settingsPath: string;
  /** Claude Code language name (e.g. "Chinese"). */
  readonly language: string;
}

/** Nearest ancestor of `start` holding `.lore/`; `start` itself when none does (same rule as `lore fragments`). */
function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".lore"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/**
 * Resolves both config layers' `context.language` into settings writes WITHOUT touching disk:
 * global (XDG) -> `<claudeDir>/settings.json`, project -> `<projectRoot>/.claude/settings.local.json`
 * (the exact two paths `lore fragments check` compares). An unknown code is a VALIDATION_ERROR
 * naming it; callers run this BEFORE any write so nothing lands on a refusal.
 */
function planLanguageProjections(claudeDir: string, cwd: string, inv: Invocation): Result<LanguageProjection[], LoreError> {
  const plan: LanguageProjection[] = [];

  const globalConfig = loadGlobalConfig(resolveGlobalConfigPath(inv.env, inv.paths.home));
  if (!globalConfig.ok) return globalConfig;
  const globalCode = globalConfig.value.context?.language;
  if (globalCode !== undefined) {
    const name = resolveLanguageName(globalCode, "global");
    if (!name.ok) return name;
    plan.push({ layer: "global", settingsPath: join(claudeDir, "settings.json"), language: name.value });
  }

  const projectRoot = findProjectRoot(cwd);
  if (existsSync(join(projectRoot, ".lore", "config.yaml"))) {
    const projectConfig = loadConfig(projectRoot);
    if (!projectConfig.ok) return projectConfig;
    const projectCode = projectConfig.value.context?.language;
    if (projectCode !== undefined) {
      const name = resolveLanguageName(projectCode, "project");
      if (!name.ok) return name;
      plan.push({ layer: "project", settingsPath: join(projectRoot, ".claude", "settings.local.json"), language: name.value });
    }
  }
  return ok(plan);
}

/** Applies a plan through {@link ClaudeSettingsPort}; stops at the first refusal (e.g. an unparseable settings file). */
function applyLanguageProjections(plan: readonly LanguageProjection[]): Result<void, LoreError> {
  const port = new ClaudeSettingsPort(createRealClaudeSettingsFs());
  for (const item of plan) {
    const merged = port.mergeLanguage(item.settingsPath, item.language);
    if (!merged.ok) return merged;
  }
  return ok(undefined);
}

/** Reports a LoreError on stderr and sets the mapped exit code. */
function failWith(inv: Invocation, error: LoreError): void {
  process.stderr.write(formatErrorFor(inv, error) + "\n");
  setExitCode(exitCode(error));
}

/**
 * Project half of `lore setup --project`: `runContextRefresh` with `rulesOnly` (never touches
 * CLAUDE.md) so the lore rules files (`.claude/rules/lore-*.md`, D15) land, then the project-layer language projection. Runs AFTER the scaffold created
 * CLAUDE.md and `.lore/config.yaml`.
 */
/**
 * The fragment-refresh deps (`runContextRefresh`'s `budgets` + `FragmentRefreshDeps`) for one repo — the ONE
 * builder behind both `lore setup --project` (writes the rules files) and `lore setup --project --check`
 * (classifies them), so the two can never select different fragments.
 */
function buildProjectRefreshDeps(opts: {
  repoDir: string;
  assetsRoot: string;
  inv: Invocation;
}): Result<
  { budgets: MemoryFileBudgets } & Extract<ReturnType<typeof buildRefreshFragmentDeps>, { ok: true }>["value"],
  LoreError
> {
  const projectConfig = loadConfig(opts.repoDir);
  if (!projectConfig.ok) return projectConfig;
  const globalConfig = loadGlobalConfig(resolveGlobalConfigPath(opts.inv.env, opts.inv.paths.home));
  if (!globalConfig.ok) return globalConfig;
  const budgets = resolveRepoMemoryFileBudgets(opts.repoDir);
  if (!budgets.ok) return budgets;
  // reason: the SAME dep builder `lore context refresh` uses — user config dir via the shared resolver,
  // both selection files folded in, shipped skill names from the embedded manifest — so setup and
  // refresh can never select different fragments.
  const fragmentDeps = buildRefreshFragmentDeps({
    repoRoot: opts.repoDir,
    assetsRoot: opts.assetsRoot,
    home: opts.inv.paths.home,
    env: opts.inv.env,
    globalLayer: toContextLayer(globalConfig.value),
    projectLayer: toContextLayer(projectConfig.value),
  });
  if (!fragmentDeps.ok) return fragmentDeps;
  return ok({ budgets: budgets.value, ...fragmentDeps.value });
}

async function runProjectContextProjection(opts: {
  repoDir: string;
  assetsRoot: string;
  claudeDir: string;
  inv: Invocation;
}): Promise<Result<void, LoreError>> {
  const refreshDeps = buildProjectRefreshDeps(opts);
  if (!refreshDeps.ok) return refreshDeps;
  const refreshed = await runContextRefresh(
    {
      fs: makeRealContextFsPort(opts.repoDir, [opts.repoDir]),
      ...refreshDeps.value,
    },
    "",
    // reason: setup must not re-splice the scaffolded CLAUDE.md (its facts-Z1 lacks the root H2s the
    // section-structure check requires, so admission would refuse) — rules files only.
    { scope: "project", rulesOnly: true },
  );
  if (!refreshed.ok) return refreshed;

  const plan = planLanguageProjections(opts.claudeDir, opts.repoDir, opts.inv);
  if (!plan.ok) return plan;
  return applyLanguageProjections(plan.value.filter((item) => item.layer === "project"));
}

// ─── --project --check (BR-1085): classify every project-managed file, write only the cache ──

/**
 * `makeRealContextFsPort` with every mutation turned into a no-op: `runContextRefresh` then PLANS the rules and
 * skill files exactly as `lore setup --project` would write them (same selection, same fingerprint test) and
 * reports each file's would-be state, while nothing reaches disk — the check's classification and the refresh's
 * write decision are one code path, so they cannot disagree.
 */
function makeReadOnlyContextFsPort(repoDir: string): FsWritePort {
  const real = makeRealContextFsPort(repoDir, [repoDir]);
  return {
    exists: (path) => real.exists(path),
    readFile: (path) => real.readFile(path),
    listDir: (path) => real.listDir(path),
    writeFile: async () => ok(undefined),
    deleteFile: async () => ok(undefined),
    removeDirIfEmpty: async () => ok(undefined),
  };
}

/** Repo-relative POSIX form of a context-port path (the port may hand back absolute paths). */
function toRepoRelative(repoDir: string, portPath: string): string {
  return (isAbsolute(portPath) ? relative(repoDir, portPath) : portPath).split("\\").join("/");
}

/**
 * Classifies the lore rules files and fragment skill folders: a missing file is `missing`, an intact file that
 * differs from a fresh render is `outdated`, a hand-edited one is `diverged`, and a file whose fragment is no
 * longer selected is `orphaned`.
 */
async function classifyProjectRulesFiles(opts: { repoDir: string; assetsRoot: string; inv: Invocation }): Promise<Result<SetupCheckFiles, LoreError>> {
  const refreshDeps = buildProjectRefreshDeps(opts);
  if (!refreshDeps.ok) return refreshDeps;
  const planned = await runContextRefresh(
    { fs: makeReadOnlyContextFsPort(opts.repoDir), ...refreshDeps.value },
    "",
    { scope: "project", rulesOnly: true },
  );
  if (!planned.ok) return planned;
  const files: SetupCheckFiles = { outdated: [], diverged: [], missing: [], orphaned: [] };
  for (const outcome of [...planned.value.rules, ...planned.value.skills]) {
    const path = toRepoRelative(opts.repoDir, outcome.path);
    if (outcome.state === "created") files.missing.push(path);
    else if (outcome.state === "updated") files.outdated.push(path);
    else if (outcome.state === "diverged_skip") files.diverged.push(path);
    else if (outcome.state === "pruned") files.orphaned.push(path);
  }
  return ok(files);
}

/**
 * Classifies the lore entries lore projects into the project settings file (today: `language` from the project
 * config's `context.language`): absent file or key -> `missing`; a different value -> `outdated`. No configured
 * language means lore manages no entry, so nothing is reported. An unreadable settings file is a loud error.
 */
function classifyProjectSettingsEntries(repoDir: string, inv: Invocation): Result<SetupCheckFiles, LoreError> {
  const files: SetupCheckFiles = { outdated: [], diverged: [], missing: [], orphaned: [] };
  const plan = planLanguageProjections(repoDir, repoDir, inv);
  if (!plan.ok) return plan;
  const settingsFs = createRealClaudeSettingsFs();
  for (const item of plan.value.filter((entry) => entry.layer === "project")) {
    const entry = `${toRepoRelative(repoDir, item.settingsPath)}#language`;
    const raw = settingsFs.read(item.settingsPath);
    if (raw === null) {
      files.missing.push(entry);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      return err({
        code: "VALIDATION_ERROR",
        field: "settings",
        message: `${item.settingsPath} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        value: item.settingsPath,
      });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "settings",
        message: `${item.settingsPath} must hold a JSON object at its root`,
        value: item.settingsPath,
      });
    }
    const current = (parsed as Record<string, unknown>)["language"];
    if (current === undefined) files.missing.push(entry);
    else if (current !== item.language) files.outdated.push(entry);
  }
  return ok(files);
}

/**
 * `lore setup --project --check` — read-only: classifies every project-managed file (ledger hooks and baseline
 * skill, lore rules files and fragment skills, lore entries in the project settings file), writes ONLY the
 * project check cache, exits 0 in sync / 3 otherwise (4 on an unreadable ledger or settings file).
 */
async function runProjectCheck(opts: { json: boolean; assetsRoot: string; inv: Invocation }): Promise<void> {
  const repoDirResolved = resolveTrackedWriteRoot(opts.inv.cwd, opts.inv.cwd);
  if (!repoDirResolved.ok) return failWith(opts.inv, repoDirResolved.error);
  const repoDir = repoDirResolved.value;
  const ledger = await checkProjectLedger(
    {
      fs: makeRealProjectFs(),
      assets: makeRealProjectAssetSource(join(opts.assetsRoot, "project")),
      skillAssets: makeRealProjectSkillSource(opts.assetsRoot),
    },
    repoDir,
  );
  if (!ledger.ok) return failWith(opts.inv, ledger.error);
  const rules = await classifyProjectRulesFiles({ repoDir, assetsRoot: opts.assetsRoot, inv: opts.inv });
  if (!rules.ok) return failWith(opts.inv, rules.error);
  const settings = classifyProjectSettingsEntries(repoDir, opts.inv);
  if (!settings.ok) return failWith(opts.inv, settings.error);

  const parts = [ledger.value, rules.value, settings.value];
  await finishProjectSetupCheck({
    repoDir,
    json: opts.json,
    files: {
      outdated: parts.flatMap((part) => part.outdated),
      diverged: parts.flatMap((part) => part.diverged),
      missing: parts.flatMap((part) => part.missing),
      orphaned: parts.flatMap((part) => part.orphaned),
    },
  });
}

async function runProjectScaffold(opts: {
  json: boolean;
  yes: boolean;
  assetsRoot: string;
  binPath: string;
  claudeDir: string;
  inv: Invocation;
}): Promise<void> {
  const repoDirResolved = resolveTrackedWriteRoot(opts.inv.cwd, opts.inv.cwd);
  if (!repoDirResolved.ok) return failWith(opts.inv, repoDirResolved.error);
  const repoDir = repoDirResolved.value;

  const proceed = await confirmOrReport({
    yes: opts.yes,
    json: opts.json,
    verb: "scaffold",
    preview: () =>
      `This will scaffold ${repoDir} with the Lore-governed project workflow ` +
      `(.lore/ init, hooks/, lore.tree.yaml, .gitignore, CLAUDE.md, git core.hooksPath).`,
  });
  if (!proceed) return;

  const projectAssets = makeRealProjectAssetSource(join(opts.assetsRoot, "project"));

  const service = new ProjectSetupService({
    fs: makeRealProjectFs(),
    exec: makeRealProjectExec(),
    // reason: initCorpusAt itself never reads assets/project/ (asset-root resolution is
    // an ADAPTER concern, per setup-args.ts's own module doc) — this closure reads the
    // recommended config-template overlay via the SAME asset source the hooks/tree.yaml
    // steps already use, then forwards it as initCorpusAt's configTemplateYaml option.
    // A missing/unreadable template degrades to a plain initCorpusAt(repoDir) call
    // (byte-identical to pre-SPEC-058 behaviour) rather than failing the whole scaffold.
    initCorpus: async (targetRepoDir: string) => {
      const templateResult = await projectAssets.readAsset(CONFIG_TEMPLATE_ASSET_NAME);
      return initCorpusAt(
        targetRepoDir,
        ambientOfInvocation(opts.inv),
        templateResult.ok ? { configTemplateYaml: templateResult.value } : {},
      );
    },
    assets: projectAssets,
    writeAdoptionMode: writeAdoptionModeToConfig,
    resolveMemoryFileBudgets: resolveRepoMemoryFileBudgets,
    skillAssets: makeRealProjectSkillSource(opts.assetsRoot),
    seedAcCiteMode: (dir) => seedAcCiteModeAudited(dir, opts.inv),
  });

  const result = await service.scaffold(repoDir);
  if (!result.ok) {
    process.stderr.write(formatErrorFor(opts.inv, result.error) + "\n");
    setExitCode(exitCode(result.error));
    return;
  }

  // reason: report.backups/manifest.detail are repo-RELATIVE paths (see
  // flows/setup-project-flow.ts's module doc, "`backups` semantics") — this
  // adapter is the one place that resolves them to absolute paths for
  // display, mirroring how targetDir/binPath are resolved here rather than
  // in the flow (which stays repoDir-relative and IO-agnostic beyond its
  // injected ports).
  const receipt: ProjectScaffoldReceipt = {
    ...result.value,
    backups: result.value.backups.map((relPath) => join(repoDir, relPath)),
    manifestPath: join(repoDir, PROJECT_MANIFEST_RELATIVE_PATH),
  };

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: { ...receipt, next_steps: PROJECT_NEXT_STEPS } }, null, 2));
  } else {
    console.log(renderProjectScaffoldReceipt(receipt, { targetDir: repoDir, binPath: opts.binPath }));
  }
  setExitCode(scaffoldReportFailed(result.value) ? 1 : 0);

  // reason: runs only after a scaffold that did not itself fail — a failed scaffold may lack the
  // CLAUDE.md / config the refresh flow reads, and its own non-zero exit already reports the run.
  if (scaffoldReportFailed(result.value)) return;
  const projected = await runProjectContextProjection({ repoDir, assetsRoot: opts.assetsRoot, claudeDir: opts.claudeDir, inv: opts.inv });
  if (!projected.ok) failWith(opts.inv, projected.error);
}

/**
 * `lore setup --project --uninstall` (SPEC-060 §Design D2) — reverses a prior
 * `--project` scaffold strictly via its OWN repo-level install ledger
 * (`.lore/.lore-project-manifest.json`), never through `SetupService` (the
 * SEPARATE global `~/.claude` installer `lore setup --uninstall` alone
 * targets). Thin pipe over `flows/setup-project-uninstall.ts::uninstallProject`.
 */
async function runProjectUninstall(opts: { json: boolean; yes: boolean; inv: Invocation }): Promise<void> {
  const repoDirResolved = resolveTrackedWriteRoot(opts.inv.cwd, opts.inv.cwd);
  if (!repoDirResolved.ok) return failWith(opts.inv, repoDirResolved.error);
  const repoDir = repoDirResolved.value;

  const proceed = await confirmOrReport({
    yes: opts.yes,
    json: opts.json,
    verb: "uninstall",
    preview: () =>
      `This will uninstall the Lore project scaffold from ${repoDir}, restoring or removing every ` +
      `file tracked by its install ledger (.lore/.lore-project-manifest.json).`,
  });
  if (!proceed) return;

  const result = await uninstallProject(makeRealProjectRemoveFs(), { repoDir });
  if (!result.ok) {
    process.stderr.write(formatErrorFor(opts.inv, result.error) + "\n");
    setExitCode(exitCode(result.error));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
  } else {
    console.log(renderProjectUninstallReport(repoDir, result.value));
  }
  setExitCode(0);
}

async function runDryRun(inv: Invocation, service: SetupService, targetDir: string, binPath: string, json: boolean): Promise<void> {
  const planResult = await service.planInstall({ targetDir });
  if (!planResult.ok) {
    process.stderr.write(formatErrorFor(inv, planResult.error) + "\n");
    setExitCode(exitCode(planResult.error));
    return;
  }

  if (json) {
    console.log(JSON.stringify({ ok: true, data: { targetDir, binPath, plan: planResult.value } }, null, 2));
  } else {
    console.log(renderInstallPlan(planResult.value, { targetDir, binPath }));
  }
  setExitCode(0);
}

/**
 * Renders the diverged-skip section (SPEC-076 §C3 D2, task
 * task-skill-implement-t5-converge-hardening-diverged-skip-force) — one line
 * per skipped path plus a literal repair command, appended directly here
 * (rather than inside `renderInstallReceipt`, `../setup-render.js`, which is
 * a sibling task's claimed anchor). No-op when `skippedDiverged` is empty
 * (fresh install, or an update converge with nothing diverged).
 */
function renderDivergedSkipSection(skippedDiverged: string[]): void {
  if (skippedDiverged.length === 0) return;
  console.log("");
  console.log(`skipped (diverged, ${skippedDiverged.length}) — user-modified, not overwritten:`);
  for (const p of skippedDiverged) {
    console.log(`  ${p}`);
    console.log("    repair: lore setup --yes --force-diverged");
  }
}

async function runInstall(inv: Invocation, 
  service: SetupService,
  mcpRegistrar: CapturingMcpRegistrar,
  opts: { targetDir: string; binPath: string; json: boolean; yes: boolean; forceDiverged: boolean; inv: Invocation },
): Promise<void> {
  // reason: resolved BEFORE the confirm prompt and any write — an unknown context.language code
  // (AC-CF-18) must refuse the whole run with nothing installed, not leave a half-applied setup.
  const languagePlan = planLanguageProjections(opts.targetDir, opts.inv.cwd, opts.inv);
  if (!languagePlan.ok) {
    failWith(inv, languagePlan.error);
    return;
  }

  const proceed = await confirmOrReport({
    yes: opts.yes,
    json: opts.json,
    verb: "install",
    preview: () => {
      // reason: a preview is only ever rendered on the interactive-prompt path (see
      // confirmOrReport) — computing it eagerly for --yes/non-interactive runs would be a
      // wasted extra planInstall() read. This closure can't be async, so callers on the
      // prompt path accept a plain textual fallback here; the REAL plan preview a curious
      // user can inspect first is `lore setup --dry-run`.
      return `This will install lore's skills/agents/hooks/governance into ${opts.targetDir} and register the lore MCP server (binary: ${opts.binPath}). Run \`lore setup --dry-run\` first to preview the exact file plan.`;
    },
  });
  if (!proceed) return;

  // reason: the global-layer language lands in `<targetDir>/settings.json`, the very file the install
  // merges hooks into. Handing it to `install` makes the manifest sha the sha of the FINAL bytes (report
  // #233); the post-install projection below then finds the value already equal and writes nothing.
  const settingsPath = join(opts.targetDir, "settings.json");
  const settingsLanguage = languagePlan.value.find(
    (item) => item.layer === "global" && item.settingsPath === settingsPath,
  )?.language;

  const result = await service.install({
    targetDir: opts.targetDir,
    binPath: opts.binPath,
    forceDiverged: opts.forceDiverged,
    ...(settingsLanguage !== undefined ? { settingsLanguage } : {}),
  });
  if (!result.ok) {
    process.stderr.write(formatErrorFor(inv, result.error) + "\n");
    setExitCode(exitCode(result.error));
    return;
  }

  const ctx = renderCtx(opts.targetDir, opts.binPath, mcpRegistrar.lastError);
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
  } else {
    console.log(renderInstallReceipt(result.value, ctx));
    renderDivergedSkipSection(result.value.skippedDiverged);
  }
  setExitCode(mcpOutcomeExitCode(result.value));

  const projected = applyLanguageProjections(languagePlan.value);
  if (!projected.ok) failWith(opts.inv, projected.error);
}

async function runUninstall(inv: Invocation, 
  service: SetupService,
  mcpRegistrar: CapturingMcpRegistrar,
  opts: { targetDir: string; binPath: string; json: boolean; yes: boolean },
): Promise<void> {
  const proceed = await confirmOrReport({
    yes: opts.yes,
    json: opts.json,
    verb: "uninstall",
    preview: () =>
      `This will uninstall lore from ${opts.targetDir}, restoring or removing every file tracked by its setup manifest.`,
  });
  if (!proceed) return;

  const result = await service.uninstall({ targetDir: opts.targetDir });
  if (!result.ok) {
    process.stderr.write(formatErrorFor(inv, result.error) + "\n");
    setExitCode(exitCode(result.error));
    return;
  }

  const ctx = renderCtx(opts.targetDir, opts.binPath, mcpRegistrar.lastError);
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
  } else {
    console.log(renderUninstallReceipt(result.value, ctx));
  }
  setExitCode(mcpOutcomeExitCode(result.value));
}

/**
 * MCP registration/de-registration never aborts a run (file-asset work
 * already completed) but the CALLER must still surface a non-zero exit so a
 * CI/scripted caller notices — the manual recovery command is already named
 * in the rendered/JSON receipt's mcp line. Mirrors `verify.ts`'s "ran fine,
 * one part failed" exit-1 bucket.
 */
function mcpOutcomeExitCode(receipt: SetupReceipt): number {
  return receipt.mcp === "failed" ? 1 : 0;
}

/**
 * Runs the GitHub-channel health probe (`../setup-github-health.js`, task
 * task-skill-implement-lore-setup-check-read-only-health-probe, AC-GI-2's
 * pre-flight discoverability half) as a second, independent section of
 * `lore setup --check`'s output — see this file's `--check` dispatch below.
 * Read-only: constructs its own `GhRunner` with the real subprocess
 * executor, never anything this file's asset-freshness check (`runSetupCheck`)
 * already wrote or read.
 *
 * Never DOWNGRADES an already-nonzero exit code from the asset-freshness
 * check that ran just before this — if that check is already reporting a
 * problem (`process.exitCode` not 0), this section still PRINTS its own
 * finding but leaves the exit code alone, so the FIRST-detected problem
 * stays the one a caller's `$?` reports; a clean asset check (`0`) is the
 * only state this is allowed to override.
 */
async function runGitHubChannelHealthCheck(opts: { json: boolean; inv: Invocation }): Promise<void> {
  const runner = createGhRunnerHealthProbe(new GhRunner({ execFile: createNodeGhExecFile(), env: opts.inv.env }));
  const report = await runGitHubHealthCheck({ runner });

  if (opts.json) {
    console.log(JSON.stringify({ ok: report.ok, data: { github_channel: report } }, null, 2));
  } else if (report.ok) {
    console.log(`✓ GitHub feedback channel reachable — ${report.message}`);
  } else {
    process.stderr.write(`✗ GitHub feedback channel unavailable: ${report.message}\n`);
  }

  if (!report.ok && getExitCode() === 0) {
    setExitCode(ghHealthExitCode(report.condition));
  }
}

/**
 * `--check`'s full dispatch — composes the asset-freshness check
 * (`computeSetupCheckReport`/`runSetupCheck`) with the GitHub-channel
 * health probe (`runGitHubHealthCheck`/`runGitHubChannelHealthCheck`). See
 * this file's module doc, "`--check --json` composition", for why the two
 * sections must NOT each print their own top-level JSON value.
 *
 * Non-`--json`: unchanged from before this fix — two independently
 * rendered human sections, in the same order, same exit-code precedence.
 *
 * `--json`: computes both reports WITHOUT letting either print, then emits
 * exactly one `console.log(JSON.stringify(...))` with the channel report
 * nested at `data.github_channel`. If the freshness computation itself
 * fails (`computeSetupCheckReport` returns `err`), it — like before this
 * fix — never wrote anything to stdout (only `formatError` to stderr), so
 * there is nothing to compose: the channel probe's own single document
 * (via `runGitHubChannelHealthCheck`) is already the whole of stdout, byte-
 * identical to pre-fix behavior for that path.
 *
 * Exit-code precedence is preserved exactly (this file's module doc, "Exit
 * codes"): the channel probe never downgrades an already-nonzero freshness
 * exit, and may only override a clean `0`.
 */
async function runCheckDispatch(opts: { targetDir: string; json: boolean; inv: Invocation }): Promise<void> {
  if (!opts.json) {
    await runSetupCheck({ targetDir: opts.targetDir, json: false, cwd: opts.inv.cwd, inv: opts.inv });
    await runGitHubChannelHealthCheck({ json: false, inv: opts.inv });
    return;
  }

  const freshnessResult = await computeSetupCheckReport({ targetDir: opts.targetDir, cwd: opts.inv.cwd });
  if (!freshnessResult.ok) {
    process.stderr.write(formatErrorFor(opts.inv, freshnessResult.error) + "\n");
    setExitCode(exitCode(freshnessResult.error));
    await runGitHubChannelHealthCheck({ json: true, inv: opts.inv });
    return;
  }
  const report = freshnessResult.value;

  const runner = createGhRunnerHealthProbe(new GhRunner({ execFile: createNodeGhExecFile(), env: opts.inv.env }));
  const channelReport = await runGitHubHealthCheck({ runner });

  console.log(JSON.stringify({ ok: true, data: { ...report, github_channel: channelReport } }, null, 2));

  setExitCode(report.summary === "sync" ? 0 : 3);
  if (!channelReport.ok && getExitCode() === 0) {
    setExitCode(ghHealthExitCode(channelReport.condition));
  }
}

/**
 * The asset/bin path context shared by every mode that reads shipped assets.
 * reason: Bun.isStandaloneExecutable does not exist on this repo's pinned Bun/bun-types
 * (1.3.x) — see setup-args.ts's module doc for the empirically-verified `/$bunfs/`
 * detection this repo uses instead.
 */
function buildSetupPathContext(inv: Invocation): SetupPathContext {
  return {
    repoRoot: REPO_ROOT,
    isCompiled: inv.isCompiled,
    execPath: inv.execPath,
  };
}

// ─── Command ─────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "setup",
    description:
      "Install Lore's Claude Code integration globally, or scaffold the current repo's project workflow (--project)",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Print the install plan only — zero writes",
    },
    uninstall: {
      type: "boolean",
      description: "Reverse a prior install via its setup manifest",
    },
    check: {
      type: "boolean",
      description:
        "Read-only freshness check against the embedded asset manifest — exit 0 sync / 3 stale, writes only the check cache",
    },
    project: {
      type: "boolean",
      description: "Scaffold the CURRENT repo's Lore-governed project workflow instead of the global machine install",
    },
    "claude-dir": {
      type: "string",
      description: "Override the target Claude Code config directory (default: $CLAUDE_CONFIG_DIR or ~/.claude)",
    },
    "force-diverged": {
      type: "boolean",
      description:
        "Install/converge mode only: overwrite diverged (user-modified) managed files instead of skipping them — backs up the user's version first (SPEC-076 §C3 D2)",
    },
    yes: {
      type: "boolean",
      description: "Skip the confirmation prompt before a mutating run (required for non-interactive invocations)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const json = args.json === true;
    const claudeDirFlag = typeof args["claude-dir"] === "string" ? args["claude-dir"] : undefined;

    // ── --check: fully separate, read-only dispatch — see header doc. ──────
    if (args.check === true) {
      const mutexFlag =
        args.uninstall === true
          ? "--uninstall"
          : args["dry-run"] === true
            ? "--dry-run"
            : args["force-diverged"] === true
              ? "--force-diverged"
              : undefined;
      if (mutexFlag !== undefined) {
        process.stderr.write(
          `Error: --check cannot be combined with ${mutexFlag} — a read-only check has no separate mutate mode.\n`,
        );
        setExitCode(2);
        return;
      }
      if (args.project === true) {
        // reason: BR-849 — `--check --project` checks the PROJECT install (BR-1085). `--claude-dir` stays refused
        // exactly as `--project` alone refuses it: the project scaffold has no machine target to redirect.
        if (claudeDirFlag !== undefined) {
          process.stderr.write("Error: --check --project cannot be combined with --claude-dir — the project check reads only the current repo.\n");
          setExitCode(2);
          return;
        }
        await runProjectCheck({ json, assetsRoot: resolveAssetsRoot(buildSetupPathContext(inv)), inv });
        return;
      }
      const checkTargetDir = resolveTargetDir({
        ...(claudeDirFlag !== undefined ? { claudeDirFlag } : {}),
        env: inv.env,
        homeDir: inv.paths.home,
      });
      await runCheckDispatch({ targetDir: checkTargetDir, json, inv });
      return;
    }

    const validated = validateSetupFlags({
      dryRun: args["dry-run"] === true,
      uninstall: args.uninstall === true,
      project: args.project === true,
      ...(claudeDirFlag !== undefined ? { claudeDir: claudeDirFlag } : {}),
    });
    if (!validated.ok) {
      process.stderr.write(`Error: ${validated.message}\n`);
      setExitCode(2);
      return;
    }

    // reason: SetupService.assertSafeTargetDir refuses a targetDir that IS/nests the REAL
    // `<home>/.claude` UNLESS the guard's env carries LORE_SETUP_ALLOW_REAL=1 (see
    // service/setup-service.ts's module doc) — that guard exists to stop a test that constructs
    // SetupService DIRECTLY (bypassing this adapter) from accidentally hitting a developer's real
    // ~/.claude. Reaching THIS adapter at all — the compiled production binary, or an integration test
    // that deliberately spawns the real CLI with an overridden $HOME to simulate a genuine run — IS a
    // legitimate "lore setup" intent, so this adapter always opts in on the caller's behalf, by putting
    // the flag in the `userState` it hands the service (below) instead of writing the process
    // environment. Direct SetupService test construction never sets it and stays guarded.

    const pathCtx = buildSetupPathContext(inv);
    const assetsRoot = resolveAssetsRoot(pathCtx);
    const binPath = resolveBinPath(pathCtx);

    if (validated.mode === "project") {
      const claudeDir = resolveTargetDir({
        ...(claudeDirFlag !== undefined ? { claudeDirFlag } : {}),
        env: inv.env,
        homeDir: inv.paths.home,
      });
      await runProjectScaffold({ json, yes: args.yes === true, assetsRoot, binPath, claudeDir, inv });
      return;
    }
    if (validated.mode === "project-uninstall") {
      await runProjectUninstall({ json, yes: args.yes === true, inv });
      return;
    }

    const targetDir = resolveTargetDir({
      ...(claudeDirFlag !== undefined ? { claudeDirFlag } : {}),
      env: inv.env,
      homeDir: inv.paths.home,
    });

    const mcpRegistrar = new CapturingMcpRegistrar(new RealMcpRegistrar(inv.env));
    const service = new SetupService(
      new RealAssetSource(assetsRoot),
      new RealSetupFsReader(),
      new RealSetupFsWriter(),
      mcpRegistrar,
      // reason: this adapter opts in to the real `~/.claude` (see the LORE_SETUP_ALLOW_REAL note above), so the guard
      // input carries the flag explicitly instead of reading the process environment back.
      { env: { ...inv.env, LORE_SETUP_ALLOW_REAL: "1" }, home: inv.paths.home },
    );

    if (validated.mode === "dry-run") {
      await runDryRun(inv, service, targetDir, binPath, json);
      return;
    }
    if (validated.mode === "uninstall") {
      await runUninstall(inv, service, mcpRegistrar, { targetDir, binPath, json, yes: args.yes === true });
      return;
    }
    await runInstall(inv, service, mcpRegistrar, {
      targetDir,
      binPath,
      json,
      yes: args.yes === true,
      forceDiverged: args["force-diverged"] === true,
      inv,
    });
  },
});
