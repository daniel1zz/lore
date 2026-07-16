/**
 * lore setup [--dry-run] [--uninstall] [--project] [--claude-dir <path>] [--yes] [--json]
 *
 * Thin CLI adapter wiring `SetupService` (global machine install into a
 * Claude Code config directory, conventionally `~/.claude`) and
 * `ProjectSetupService` (per-repo project scaffold, `--project`) to real,
 * `node:fs`/`node:child_process`-backed ports (`RealAssetSource`,
 * `RealSetupFsReader`/`RealSetupFsWriter`, `RealMcpRegistrar`) — the FINAL
 * SPEC-046 wiring task, connecting every previously-merged service/port/
 * renderer into a reachable CLI verb (SPEC-046 §Design, task AC-046-E).
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
 *   (install/uninstall/`--project`) prompts when interactive
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

import { SetupService, type McpRegistrar, type SetupReceipt } from "../../../service/setup-service.js";
import { ProjectSetupService } from "../../../service/project-setup-service.js";
import type { ExecPort, ProjectFsPort, ProjectAssetSource, ProjectScaffoldReport } from "../../../flows/setup-project-flow.js";
import { initCorpusAt } from "../../../flows/init-corpus.js";
import { RealAssetSource } from "../../real-asset-source.js";
import { RealSetupFsReader, RealSetupFsWriter } from "../../real-setup-fs.js";
import { RealMcpRegistrar } from "../../real-mcp-registrar.js";
import { renderInstallPlan, renderInstallReceipt, renderUninstallReceipt, type SetupRenderCtx } from "../setup-render.js";
import {
  resolveAssetsRoot,
  resolveBinPath,
  resolveTargetDir,
  validateSetupFlags,
  type SetupPathContext,
} from "../setup-args.js";
import { exitCode, formatError } from "../utils.js";

// ─── Repo-root resolution (dev mode only — see setup-args.ts's module doc) ──
// packages/lore/src/adapters/cli/commands/setup.ts -> repo root is 6 levels up.

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

// ─── MCP failure-detail capture ──────────────────────────────────────────────

/**
 * Wraps a real `McpRegistrar`, remembering the last `add`/`remove` failure's
 * message so it can be threaded into `SetupRenderCtx.mcpErrorTail` — SPEC-046
 * deliberately keeps `SetupReceipt.mcp` a bare tri-state marker with no error
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

  async add(binPath: string): Promise<Result<void, LoreError>> {
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

// ─── --project rendering (no shared renderer exists for this report shape) ──

function renderScaffoldReport(repoDir: string, report: ProjectScaffoldReport): string {
  const lines: string[] = [];
  lines.push(`✓ lore project scaffold → ${repoDir}`);
  lines.push("");
  lines.push(`Init: ${report.init.status}${report.init.detail ? ` (${report.init.detail})` : ""}`);
  lines.push("");
  lines.push("Hooks:");
  for (const hook of report.hooks) {
    lines.push(`  ${hook.file}: ${hook.status}${hook.detail ? ` (${hook.detail})` : ""}`);
  }
  lines.push("");
  lines.push(`Tree blueprint: ${report.tree_yaml.status}${report.tree_yaml.detail ? ` (${report.tree_yaml.detail})` : ""}`);
  lines.push(
    `Git hooksPath: ${report.git_hooks_path.status} (prior: ${report.git_hooks_path.prior_value ?? "unset"})` +
      (report.git_hooks_path.detail ? ` — ${report.git_hooks_path.detail}` : ""),
  );
  return lines.join("\n");
}

function scaffoldReportFailed(report: ProjectScaffoldReport): boolean {
  return (
    report.init.status === "failed" ||
    report.tree_yaml.status === "failed" ||
    report.git_hooks_path.status === "failed" ||
    report.hooks.some((h) => h.status === "failed")
  );
}

// ─── Real project-scaffold ports (mirrors project-setup-service.test.ts's real port builders) ──

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
  };
}

function makeRealProjectExec(): ExecPort {
  return {
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

async function runProjectScaffold(opts: { json: boolean; yes: boolean; assetsRoot: string }): Promise<void> {
  const repoDir = process.cwd();

  const proceed = await confirmOrReport({
    yes: opts.yes,
    json: opts.json,
    verb: "scaffold",
    preview: () =>
      `This will scaffold ${repoDir} with the Lore-governed project workflow ` +
      `(.lore/ init, hooks/, lore.tree.yaml, git core.hooksPath).`,
  });
  if (!proceed) return;

  const service = new ProjectSetupService({
    fs: makeRealProjectFs(),
    exec: makeRealProjectExec(),
    initCorpus: initCorpusAt,
    assets: makeRealProjectAssetSource(join(opts.assetsRoot, "project")),
  });

  const result = await service.scaffold(repoDir);
  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
  } else {
    console.log(renderScaffoldReport(repoDir, result.value));
  }
  process.exitCode = scaffoldReportFailed(result.value) ? 1 : 0;
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

async function runInstall(
  service: SetupService,
  mcpRegistrar: CapturingMcpRegistrar,
  opts: { targetDir: string; binPath: string; json: boolean; yes: boolean },
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

  const result = await service.install({ targetDir: opts.targetDir, binPath: opts.binPath });
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
    project: {
      type: "boolean",
      description: "Scaffold the CURRENT repo's Lore-governed project workflow instead of the global machine install",
    },
    "claude-dir": {
      type: "string",
      description: "Override the target Claude Code config directory (default: $CLAUDE_CONFIG_DIR or ~/.claude)",
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

    if (validated.mode === "project") {
      await runProjectScaffold({ json, yes: args.yes === true, assetsRoot });
      return;
    }

    const targetDir = resolveTargetDir({
      ...(claudeDirFlag !== undefined ? { claudeDirFlag } : {}),
      env: process.env,
      homeDir: homedir(),
    });
    const binPath = resolveBinPath(pathCtx);

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
    await runInstall(service, mcpRegistrar, { targetDir, binPath, json, yes: args.yes === true });
  },
});
