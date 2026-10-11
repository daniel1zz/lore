/**
 * `lore fragments render | check | pointers` — read-only, hook-facing context-fragment verbs.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D3, D6, D7, D12, D13).
 *
 *   - `render --outlet <hook:session-start|hook:subagent-start> [--agent-type T] [--cwd P] [--explain]`
 *       prints `{"hookSpecificOutput":{"hookEventName","additionalContext"}}` to stdout. For a hook
 *       outlet ANY failure still exits 0 and emits a <= 400-char banner carrying the error code (D12:
 *       hooks never block start, never emit nothing).
 *   - `check [--json]` enumerates every outlet × agent type; exits 4 on cap overflow, rules-file drift,
 *       override refusal or Claude Code `language` drift (findings on stderr, or in the JSON report).
 *   - `pointers --cwd P` prints the project pointer lines (<= POINTER_CEILING chars).
 *
 * Bootstrap-stage exemption (adapters/cli/CLAUDE.md "Key Invariants" #4, same as commands/governance.ts):
 * this command MUST NOT import `loader.ts` / `bun:sqlite` / `loadLoreApp`. Config is read straight
 * from YAML; fragments come from three on-disk layers; `pointers` spawns `lore bootstrap --json`
 * instead of opening the corpus DB. The writer of the lore rules files stays `lore context` (D13, D15).
 *
 * Layer roots: shipped `<assetsRoot>/context`, user `<global config dir>/context`
 * (`$LORE_CONFIG_HOME` > `$XDG_CONFIG_HOME/lore` > `~/.config/lore`), project `<root>/.lore/context`,
 * where `<root>` is the nearest ancestor of `--cwd` that holds `.lore/` (else `--cwd` itself).
 *
 * Side-effect class: IO (file reads, one `lore bootstrap` spawn for `pointers`, stdout/stderr writes).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  ContextFragmentsSettingsSchema,
  contextConfigSchema,
  OUTLET_IDS,
  type ContextConfigLayer,
  type FsReadPort,
} from "@lore/core";
import { resolveGlobalConfigPath } from "@lore/core/node";
import {
  buildHookBanner,
  HOOK_OUTLETS,
  runFragmentsCheck,
  runFragmentsRender,
  type FragmentsFlowDeps,
  type FragmentsFlowError,
  type HookOutlet,
} from "../../../flows/fragments-flow.js";
import { buildProjectPointers } from "../../../flows/project-pointers-flow.js";
import { resolveAssetsRoot, resolveTargetDir, type SetupPathContext } from "../setup-args.js";
import { writeAllSync } from "../stdio-sync.js";

const ACTIONS = ["render", "check", "pointers"] as const;
type Action = (typeof ACTIONS)[number];

const HOOK_EVENT_NAMES: Readonly<Record<HookOutlet, string>> = {
  "hook:session-start": "SessionStart",
  "hook:subagent-start": "SubagentStart",
};

/** Exit code for a failed `check` — the VALIDATION_ERROR family (adapters/cli/utils.ts `exitCode`). */
const CHECK_FAILED_EXIT = 4;
const USAGE_EXIT = 2;
const BOOTSTRAP_TIMEOUT_MS = 5000;

// Same 6-level derivation as commands/governance.ts (this file sits in the same directory).
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

function resolveAssets(): string {
  const ctx: SetupPathContext = {
    repoRoot: REPO_ROOT,
    isCompiled: Bun.main.startsWith("/$bunfs/"),
    execPath: process.execPath,
  };
  return resolveAssetsRoot(ctx);
}

/** Nearest ancestor of `start` that contains `.lore/`; `start` itself when none does. */
function resolveProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".lore"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** `$LORE_CONFIG_HOME` > `$XDG_CONFIG_HOME/lore` > `~/.config/lore` — directory of the user layer + global config. */
function resolveUserConfigDir(): string {
  const loreHome = process.env["LORE_CONFIG_HOME"];
  if (loreHome) return loreHome;
  const xdg = process.env["XDG_CONFIG_HOME"];
  return xdg ? join(xdg, "lore") : join(homedir(), ".config", "lore");
}

/** Absolute-path, read-only FsReadPort (collapses ordinary failure like `real-fs-probe.ts`). */
function buildAbsoluteFsPort(): FsReadPort {
  return {
    async exists(path) {
      return existsSync(path);
    },
    async readFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    async listDir(path) {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
  };
}

type LayerResult = { ok: true; value: ContextConfigLayer } | { ok: false; error: FragmentsFlowError };

/** Read `<file>`'s `context:` block; a missing file is an empty layer, an unreadable or invalid one is an error. */
function loadContextLayer(path: string | undefined, schema: z.ZodTypeAny): LayerResult {
  if (path === undefined || !existsSync(path)) return { ok: true, value: {} };
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}` },
    };
  }
  const context = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>)["context"] : undefined;
  if (context === undefined || context === null) return { ok: true, value: {} };
  const parsed = schema.safeParse(context);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, error: { code: "VALIDATION_ERROR", message: `${path}: invalid context block — ${issues}` } };
  }
  return { ok: true, value: { context: parsed.data as NonNullable<ContextConfigLayer["context"]> } };
}

export type DepsResult = { ok: true; value: FragmentsFlowDeps } | { ok: false; error: FragmentsFlowError };

export function buildFlowDeps(cwd: string): DepsResult {
  const projectRoot = resolveProjectRoot(cwd);
  const global = loadContextLayer(resolveGlobalConfigPath(), ContextFragmentsSettingsSchema);
  if (!global.ok) return global;
  const project = loadContextLayer(join(projectRoot, ".lore", "config.yaml"), contextConfigSchema);
  if (!project.ok) return project;
  const assetsRoot = resolveAssets();
  const claudeDir = resolveTargetDir({ env: process.env, homeDir: homedir() });
  return {
    ok: true,
    value: {
      fs: buildAbsoluteFsPort(),
      roots: {
        shipped: join(assetsRoot, "context"),
        user: join(resolveUserConfigDir(), "context"),
        project: join(projectRoot, ".lore", "context"),
      },
      globalConfig: global.value,
      projectConfig: project.value,
      projectClaudeMdPath: join(projectRoot, "CLAUDE.md"),
      agentsDir: join(assetsRoot, "agents"),
      userSettings: { scope: "user", path: join(claudeDir, "settings.json") },
      projectSettings: { scope: "project", path: join(projectRoot, ".claude", "settings.local.json") },
    },
  };
}

function isHookOutlet(value: string): value is HookOutlet {
  return (HOOK_OUTLETS as readonly string[]).includes(value);
}

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

function usageError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = USAGE_EXIT;
}

function emitHookJson(outlet: HookOutlet, additionalContext: string): void {
  writeAllSync(
    1,
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: HOOK_EVENT_NAMES[outlet], additionalContext } })}\n`,
  );
}

async function runRender(args: Record<string, unknown>, cwd: string): Promise<void> {
  const outlet = typeof args["outlet"] === "string" ? args["outlet"] : "";
  if (!isHookOutlet(outlet)) {
    usageError(`lore fragments render requires --outlet <${HOOK_OUTLETS.join("|")}> (got "${outlet}"; known outlets: ${OUTLET_IDS.join(", ")})`);
    return;
  }
  const agentType = typeof args["agent-type"] === "string" && args["agent-type"] !== "" ? args["agent-type"] : undefined;

  const deps = buildFlowDeps(cwd);
  const result = deps.ok
    ? await runFragmentsRender(deps.value, { outlet, ...(agentType !== undefined ? { agentType } : {}) })
    : deps;
  if (!result.ok) {
    // D12: a hook never blocks start and never emits nothing — banner with the code, exit 0.
    emitHookJson(outlet, buildHookBanner(result.error));
    process.stderr.write(`lore fragments render: ${result.error.code}: ${result.error.message}\n`);
    return;
  }
  if (args["explain"] === true) {
    for (const row of result.value.explain) process.stderr.write(`explain: ${row.id} layer=${row.layer} chars=${row.chars}\n`);
  }
  emitHookJson(outlet, result.value.additionalContext);
}

async function runCheck(args: Record<string, unknown>, cwd: string): Promise<void> {
  const json = args["json"] === true;
  const deps = buildFlowDeps(cwd);
  if (!deps.ok) {
    if (json) writeAllSync(1, `${JSON.stringify({ ok: false, error: deps.error })}\n`);
    process.stderr.write(`lore fragments check: ${deps.error.code}: ${deps.error.message}\n`);
    process.exitCode = CHECK_FAILED_EXIT;
    return;
  }
  const report = await runFragmentsCheck(deps.value);
  if (json) {
    writeAllSync(1, `${JSON.stringify({ ok: report.ok, data: report })}\n`);
  } else {
    writeAllSync(
      1,
      `lore fragments check: ${report.checks.length} outlet checks across ${report.agentTypes.length} agent types — ` +
        `${report.ok ? "ok" : `${report.findings.length} finding(s)`}\n`,
    );
  }
  for (const finding of report.findings) {
    process.stderr.write(`[${finding.kind}] ${finding.code}: ${finding.message}\n`);
  }
  if (!report.ok) process.exitCode = CHECK_FAILED_EXIT;
}

async function runPointers(cwd: string): Promise<void> {
  const projectRoot = resolveProjectRoot(cwd);
  const isCompiled = Bun.main.startsWith("/$bunfs/");
  const loreArgv = isCompiled ? [process.execPath] : [process.execPath, Bun.main];
  const result = await buildProjectPointers({
    hasCorpus: () => existsSync(join(projectRoot, ".lore")),
    runBootstrap: async () => {
      const spawned = spawnSync(loreArgv[0] as string, [...loreArgv.slice(1), "bootstrap", "--json"], {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: BOOTSTRAP_TIMEOUT_MS,
        env: { ...process.env, CLAUDECODE: "1" },
      });
      return { status: spawned.status, stdout: spawned.stdout ?? "" };
    },
  });
  if (result.skipped !== undefined && result.skipped !== "no-corpus") {
    process.stderr.write(`lore fragments pointers: no pointers emitted (${result.skipped})\n`);
  }
  if (result.text.length > 0) writeAllSync(1, result.text);
}

export default defineCommand({
  meta: {
    name: "fragments",
    description:
      "Read-only context-fragment verbs, bootstrap-stage (no corpus DB): " +
      "`render --outlet <hook:session-start|hook:subagent-start>` (hook JSON), " +
      "`check [--json]` (caps, rules-file drift, override refusal, language drift), " +
      "`pointers --cwd P` (project pointer lines).",
  },
  args: {
    action: { type: "positional", description: "render | check | pointers", required: false },
    outlet: { type: "string", description: "render: hook:session-start | hook:subagent-start" },
    "agent-type": { type: "string", description: "render: subagent type for hook:subagent-start" },
    cwd: { type: "string", description: "Project directory (default: current directory)" },
    explain: { type: "boolean", description: "render: print per-fragment id/layer/chars to stderr", default: false },
    json: { type: "boolean", description: "check: print the report as JSON", default: false },
  },
  async run({ args }) {
    const action = typeof args.action === "string" ? args.action : "";
    if (!isAction(action)) {
      usageError(`lore fragments requires an action: ${ACTIONS.join(" | ")} (got "${action}")`);
      return;
    }
    const cwd = typeof args.cwd === "string" && args.cwd !== "" ? resolve(args.cwd) : process.cwd();
    const rest = args as Record<string, unknown>;
    switch (action) {
      case "render":
        return runRender(rest, cwd);
      case "check":
        return runCheck(rest, cwd);
      case "pointers":
        return runPointers(cwd);
      default: {
        const unreachable: never = action;
        throw new Error(`lore fragments: unhandled action ${String(unreachable)}`);
      }
    }
  },
});
