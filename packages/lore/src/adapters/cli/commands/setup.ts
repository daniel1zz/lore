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
 * (mutually exclusive with `--uninstall`/`--dry-run`; `--check --project` is
 * an explicit, named-exit-2 Scope-Alt — never a silent global-only check).
 * Thin pipe over `../setup-check.js::runSetupCheck` — see that module's own
 * doc for the zero-mutation-beyond-the-check-cache invariant.
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
 *   `--claude-dir <path>` > `$CLAUDE_CONFIG_DIR` > `join(homedir(), ".claude")`
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
 *
 * Source: SPEC-046 §Design, §Scope; task AC-046-E.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineCommand } from "citty";
import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

import { SetupService, type McpAddOutcome, type McpRegistrar, type SetupReceipt } from "../../../service/setup-service.js";
import { ProjectSetupService } from "../../../service/project-setup-service.js";
import {
  PROJECT_MANIFEST_RELATIVE_PATH,
  type ExecPort,
  type ProjectFsPort,
  type ProjectAssetSource,
  type ProjectScaffoldReport,
} from "../../../flows/setup-project-flow.js";
import {
  uninstallProject,
  type ProjectFsRemovePort,
  type ProjectUninstallReport,
} from "../../../flows/setup-project-uninstall.js";
import { initCorpusAt } from "../../../flows/init-corpus.js";
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
import { exitCode, formatError } from "../utils.js";
import { runSetupCheck } from "../setup-check.js";

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
    process.exitCode = 2;
    return false;
  }

  if (decision === "prompt") {
    console.log(opts.preview());
    const confirmed = await promptYesNo("Proceed? [y/N] ");
    if (!confirmed) {
      console.log("Aborted — no changes made.");
      process.exitCode = 0;
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
    // to `git config --get core.hooksPath` / `git config core.hooksPath hooks`: output
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

// ─── Mode handlers ────────────────────────────────────────────────────────────

/**
 * The recommended verification-profile overlay asset name (SPEC-058 §Design
 * Decisions D6) — sits alongside `TREE_TEMPLATE_ASSET_NAME`'s equivalent role
 * in `setup-project-flow.ts`, but is read HERE (not as a `scaffoldProject`
 * step) because it seeds `initCorpusAt`'s `configTemplateYaml` option rather
 * than being copied verbatim to a target path.
 */
const CONFIG_TEMPLATE_ASSET_NAME = "lore-config-template.yaml";

async function runProjectScaffold(opts: {
  json: boolean;
  yes: boolean;
  assetsRoot: string;
  binPath: string;
}): Promise<void> {
  const repoDir = process.cwd();

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
        templateResult.ok ? { configTemplateYaml: templateResult.value } : {},
      );
    },
    assets: projectAssets,
  });

  const result = await service.scaffold(repoDir);
  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
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
  process.exitCode = scaffoldReportFailed(result.value) ? 1 : 0;
}

/**
 * `lore setup --project --uninstall` (SPEC-060 §Design D2) — reverses a prior
 * `--project` scaffold strictly via its OWN repo-level install ledger
 * (`.lore/.lore-project-manifest.json`), never through `SetupService` (the
 * SEPARATE global `~/.claude` installer `lore setup --uninstall` alone
 * targets). Thin pipe over `flows/setup-project-uninstall.ts::uninstallProject`.
 */
async function runProjectUninstall(opts: { json: boolean; yes: boolean }): Promise<void> {
  const repoDir = process.cwd();

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
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
  } else {
    console.log(renderProjectUninstallReport(repoDir, result.value));
  }
  process.exitCode = 0;
}

async function runDryRun(service: SetupService, targetDir: string, binPath: string, json: boolean): Promise<void> {
  const planResult = await service.planInstall({ targetDir });
  if (!planResult.ok) {
    process.stderr.write(formatError(planResult.error) + "\n");
    process.exitCode = exitCode(planResult.error);
    return;
  }

  if (json) {
    console.log(JSON.stringify({ ok: true, data: { targetDir, binPath, plan: planResult.value } }, null, 2));
  } else {
    console.log(renderInstallPlan(planResult.value, { targetDir, binPath }));
  }
  process.exitCode = 0;
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

async function runInstall(
  service: SetupService,
  mcpRegistrar: CapturingMcpRegistrar,
  opts: { targetDir: string; binPath: string; json: boolean; yes: boolean; forceDiverged: boolean },
): Promise<void> {
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

  const result = await service.install({ targetDir: opts.targetDir, binPath: opts.binPath, forceDiverged: opts.forceDiverged });
  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  const ctx = renderCtx(opts.targetDir, opts.binPath, mcpRegistrar.lastError);
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
  } else {
    console.log(renderInstallReceipt(result.value, ctx));
    renderDivergedSkipSection(result.value.skippedDiverged);
  }
  process.exitCode = mcpOutcomeExitCode(result.value);
}

async function runUninstall(
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
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  const ctx = renderCtx(opts.targetDir, opts.binPath, mcpRegistrar.lastError);
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
  } else {
    console.log(renderUninstallReceipt(result.value, ctx));
  }
  process.exitCode = mcpOutcomeExitCode(result.value);
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
  async run({ args }) {
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
        process.exitCode = 2;
        return;
      }
      if (args.project === true) {
        process.stderr.write(
          "Error: --check --project is not supported yet — run `lore setup --check` (without --project) " +
            "to check the global machine install only; project-scaffold freshness checking is deferred.\n",
        );
        process.exitCode = 2;
        return;
      }
      const checkTargetDir = resolveTargetDir({
        ...(claudeDirFlag !== undefined ? { claudeDirFlag } : {}),
        env: process.env,
        homeDir: homedir(),
      });
      await runSetupCheck({ targetDir: checkTargetDir, json });
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
      process.exitCode = 2;
      return;
    }

    // reason: SetupService.assertSafeTargetDir refuses a targetDir that IS/nests the REAL
    // os.homedir()/.claude UNLESS this env var is set (see service/setup-service.ts's module
    // doc) — that guard exists to stop a test that constructs SetupService DIRECTLY
    // (bypassing this adapter) from accidentally hitting a developer's real ~/.claude.
    // Reaching THIS adapter at all — the compiled production binary, or an integration test
    // that deliberately spawns the real CLI with an overridden $HOME to simulate a genuine
    // run — IS a legitimate "lore setup" intent, so this adapter always opts in on the
    // caller's behalf. Direct SetupService test construction (setup-service.test.ts) never
    // sets this and stays guarded. `--project` never reaches SetupService at all, but
    // setting this unconditionally, before the mode branch, is simpler than threading it
    // through two branches for no behavioral difference (ProjectSetupService never reads it).
    process.env["LORE_SETUP_ALLOW_REAL"] = "1";

    // reason: Bun.isStandaloneExecutable does not exist on this repo's pinned Bun/bun-types
    // (1.3.x) — see setup-args.ts's module doc for the empirically-verified `/$bunfs/`
    // detection this repo uses instead.
    const pathCtx: SetupPathContext = {
      repoRoot: REPO_ROOT,
      isCompiled: Bun.main.startsWith("/$bunfs/"),
      execPath: process.execPath,
    };
    const assetsRoot = resolveAssetsRoot(pathCtx);
    const binPath = resolveBinPath(pathCtx);

    if (validated.mode === "project") {
      await runProjectScaffold({ json, yes: args.yes === true, assetsRoot, binPath });
      return;
    }
    if (validated.mode === "project-uninstall") {
      await runProjectUninstall({ json, yes: args.yes === true });
      return;
    }

    const targetDir = resolveTargetDir({
      ...(claudeDirFlag !== undefined ? { claudeDirFlag } : {}),
      env: process.env,
      homeDir: homedir(),
    });

    const mcpRegistrar = new CapturingMcpRegistrar(new RealMcpRegistrar());
    const service = new SetupService(
      new RealAssetSource(assetsRoot),
      new RealSetupFsReader(),
      new RealSetupFsWriter(),
      mcpRegistrar,
    );

    if (validated.mode === "dry-run") {
      await runDryRun(service, targetDir, binPath, json);
      return;
    }
    if (validated.mode === "uninstall") {
      await runUninstall(service, mcpRegistrar, { targetDir, binPath, json, yes: args.yes === true });
      return;
    }
    await runInstall(service, mcpRegistrar, {
      targetDir,
      binPath,
      json,
      yes: args.yes === true,
      forceDiverged: args["force-diverged"] === true,
    });
  },
});
