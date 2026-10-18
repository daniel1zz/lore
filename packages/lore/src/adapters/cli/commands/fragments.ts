/**
 * `lore fragments render | check | pointers` — read-only, hook-facing context-fragment verbs.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D3, D6, D7, D12, D13).
 *
 *   - `render --outlet hook:subagent-start [--agent-type T] [--cwd P] [--explain]`
 *       prints `{"hookSpecificOutput":{"hookEventName","additionalContext"}}` to stdout. For a hook
 *       outlet ANY failure still exits 0 and emits a <= 400-char banner carrying the error code (D12:
 *       hooks never block start, never emit nothing). `--outlet hook:session-start` is RETIRED (BR-912): exit 2
 *       with a stderr line naming it, never a render.
 *   - `check [--json]` enumerates every outlet × agent type; exits 4 on cap overflow, rules-file drift,
 *       override refusal, a dynamic main-session fragment (BR-1066) or Claude Code `language` drift (findings on stderr, or in the JSON report).
 *   - `pointers --cwd P` prints the project pointer lines (<= POINTER_CEILING chars).
 *
 * Bootstrap-stage exemption (adapters/cli/CLAUDE.md "Key Invariants" #4, same as commands/governance.ts):
 * this command MUST NOT import `loader.ts` / `bun:sqlite` / `loadLoreApp`. Config is read straight
 * from YAML; fragments come from three on-disk layers; `pointers` spawns `lore bootstrap --json`
 * instead of opening the corpus DB. The writer of the lore rules files stays `lore context` (D13, D15).
 *
 * Layer roots: shipped `<assetsRoot>/context`, user `<global config dir>/context`
 * (`resolveUserConfigDir`: `$LORE_CONFIG_HOME` > `$XDG_CONFIG_HOME/lore` > `~/.config/lore`), project `<root>/.lore/context`,
 * where `<root>` is the nearest ancestor of `--cwd` that holds `.lore/` (else `--cwd` itself).
 *
 * Side-effect class: IO (file reads, one `lore bootstrap` spawn for `pointers`, stdout/stderr writes).
 */
import { spawnSync } from "node:child_process";

import { existsSync, readFileSync, readdirSync } from "node:fs";
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
import { EMBEDDED_ASSETS_MANIFEST } from "../../../generated/assets-manifest.js";
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
import { SELECTION_FILE } from "../../../service/context-fragments/selection.js";
import { resolveUserConfigDir } from "../../../service/context-fragments/user-config-dir.js";
import { resolveAssetsRoot, resolveTargetDir, type SetupPathContext } from "../setup-args.js";
import { writeAllSync } from "../stdio-sync.js";
import type { Invocation } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import type { CliIo } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

const ACTIONS = ["render", "check", "pointers"] as const;
type Action = (typeof ACTIONS)[number];

const HOOK_EVENT_NAMES: Readonly<Record<HookOutlet, string>> = {
  "hook:subagent-start": "SubagentStart",
};

/** The retired session-start outlet id (BR-912): refused with a usage error, never rendered. */
const RETIRED_SESSION_START_OUTLET = "hook:session-start";

/** Exit code for a failed `check` — the VALIDATION_ERROR family (adapters/cli/utils.ts `exitCode`). */
export const CHECK_FAILED_EXIT = 4;
const USAGE_EXIT = 2;
const BOOTSTRAP_TIMEOUT_MS = 5000;

// Same 6-level derivation as commands/governance.ts (this file sits in the same directory).
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

function resolveAssets(inv: Invocation): string {
  const ctx: SetupPathContext = {
    repoRoot: REPO_ROOT,
    isCompiled: inv.isCompiled,
    execPath: inv.execPath,
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

/** Skill directory names lore ships: `skills/lore-<name>/...` entries of the embedded manifest (BR-1064). */
export function listShippedSkillNames(): string[] {
  const names = new Set<string>();
  for (const entry of EMBEDDED_ASSETS_MANIFEST.entries) {
    const match = /^skills\/(lore-[^/]+)\//.exec(entry.path);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

type SelectionTextResult = { ok: true; value: string | null } | { ok: false; error: FragmentsFlowError };

/** Raw text of a `selection.yaml`; `null` when the file is absent (legitimate), an unreadable one is an error. */
function readSelectionText(path: string): SelectionTextResult {
  if (!existsSync(path)) return { ok: true, value: null };
  try {
    return { ok: true, value: readFileSync(path, "utf8") };
  } catch (cause) {
    return {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}` },
    };
  }
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

export function buildFlowDeps(cwd: string, inv: Invocation): DepsResult {
  const projectRoot = resolveProjectRoot(cwd);
  const global = loadContextLayer(resolveGlobalConfigPath(inv.env, inv.paths.home), ContextFragmentsSettingsSchema);
  if (!global.ok) return global;
  const project = loadContextLayer(join(projectRoot, ".lore", "config.yaml"), contextConfigSchema);
  if (!project.ok) return project;
  const assetsRoot = resolveAssets(inv);
  const claudeDir = resolveTargetDir({ env: inv.env, homeDir: inv.paths.home });
  const userConfigDir = resolveUserConfigDir(inv.env, inv.paths.home);
  const userSelection = readSelectionText(join(userConfigDir, SELECTION_FILE.user));
  if (!userSelection.ok) return userSelection;
  const projectSelection = readSelectionText(join(projectRoot, SELECTION_FILE.project));
  if (!projectSelection.ok) return projectSelection;
  return {
    ok: true,
    value: {
      fs: buildAbsoluteFsPort(),
      roots: {
        shipped: join(assetsRoot, "context"),
        user: join(userConfigDir, "context"),
        project: join(projectRoot, ".lore", "context"),
      },
      globalConfig: global.value,
      projectConfig: project.value,
      projectClaudeMdPath: join(projectRoot, "CLAUDE.md"),
      agentsDir: join(assetsRoot, "agents"),
      userSettings: { scope: "user", path: join(claudeDir, "settings.json") },
      projectSettings: { scope: "project", path: join(projectRoot, ".claude", "settings.local.json") },
      userSelectionText: userSelection.value,
      projectSelectionText: projectSelection.value,
      shippedSkillNames: listShippedSkillNames(),
    },
  };
}

function isHookOutlet(value: string): value is HookOutlet {
  return (HOOK_OUTLETS as readonly string[]).includes(value);
}

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

function usageError(io: CliIo, message: string): ExitReport {
  io.stderr.write(`Error: ${message}\n`);
  return USAGE_EXIT;
}

function emitHookJson(io: CliIo, outlet: HookOutlet, additionalContext: string): void {
  io.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: HOOK_EVENT_NAMES[outlet], additionalContext } })}\n`,
  );
}

async function runRender(args: Record<string, unknown>, cwd: string, inv: Invocation): Promise<ExitReport> {
  const outlet = typeof args["outlet"] === "string" ? args["outlet"] : "";
  if (outlet === RETIRED_SESSION_START_OUTLET) {
    return usageError(inv.io, 
      `lore fragments render: outlet ${RETIRED_SESSION_START_OUTLET} is retired; the only render target is ${HOOK_OUTLETS.join("|")}. ` +
        "Session-start upgrade advice comes from the session-start-resume hook, and dynamic main fragments are refused by `lore fragments check`.",
    );
  }
  if (!isHookOutlet(outlet)) {
    return usageError(inv.io, `lore fragments render requires --outlet <${HOOK_OUTLETS.join("|")}> (got "${outlet}"; known outlets: ${OUTLET_IDS.join(", ")})`);
  }
  const agentType = typeof args["agent-type"] === "string" && args["agent-type"] !== "" ? args["agent-type"] : undefined;

  const deps = buildFlowDeps(cwd, inv);
  const result = deps.ok
    ? await runFragmentsRender(deps.value, { outlet, ...(agentType !== undefined ? { agentType } : {}) })
    : deps;
  if (!result.ok) {
    // D12: a hook never blocks start and never emits nothing — banner with the code, exit 0.
    emitHookJson(inv.io, outlet, buildHookBanner(result.error));
    inv.io.stderr.write(`lore fragments render: ${result.error.code}: ${result.error.message}\n`);
    return;
  }
  if (args["explain"] === true) {
    for (const row of result.value.explain) inv.io.stderr.write(`explain: ${row.id} layer=${row.layer} chars=${row.chars}\n`);
  }
  emitHookJson(inv.io, outlet, result.value.additionalContext);
}

/**
 * Runs the fragments check and renders it (stdout summary / `--json` report, findings on stderr),
 * setting the exit code. `label` names the invoking command in the human lines; shared with
 * `lore status --check-fragments` so the two cannot render a finding differently.
 */
export async function runCheck(args: Record<string, unknown>, cwd: string, inv: Invocation, label = "lore fragments check"): Promise<ExitReport> {
  const json = args["json"] === true;
  const deps = buildFlowDeps(cwd, inv);
  if (!deps.ok) {
    if (json) inv.io.stdout.write(`${JSON.stringify({ ok: false, error: deps.error })}\n`);
    inv.io.stderr.write(`${label}: ${deps.error.code}: ${deps.error.message}\n`);
    return CHECK_FAILED_EXIT;
  }
  const report = await runFragmentsCheck(deps.value);
  if (json) {
    inv.io.stdout.write(`${JSON.stringify({ ok: report.ok, data: report })}\n`);
  } else {
    inv.io.stdout.write(`${label}: ${report.checks.length} outlet checks across ${report.agentTypes.length} agent types — ` +
        `${report.ok ? "ok" : `${report.findings.length} finding(s)`}\n`,
    );
  }
  for (const finding of report.findings) {
    inv.io.stderr.write(`[${finding.kind}] ${finding.code}: ${finding.message}\n`);
  }
  if (!report.ok) return CHECK_FAILED_EXIT;
}

async function runPointers(cwd: string, inv: Invocation): Promise<void> {
  const projectRoot = resolveProjectRoot(cwd);
  // reason: from source the re-run is `bun <source entry>`; the Invocation carries no entry-script path, and the
  // entry (`packages/lore/src/index.ts`, the `bin` of packages/lore) is fixed relative to this module.
  const loreArgv = inv.isCompiled ? [inv.execPath] : [inv.execPath, join(REPO_ROOT, "packages", "lore", "src", "index.ts")];
  const result = await buildProjectPointers({
    hasCorpus: () => existsSync(join(projectRoot, ".lore")),
    runBootstrap: async () => {
      const spawned = spawnSync(loreArgv[0] as string, [...loreArgv.slice(1), "bootstrap", "--json"], {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: BOOTSTRAP_TIMEOUT_MS,
        env: { ...inv.env, CLAUDECODE: "1" },
      });
      return { status: spawned.status, stdout: spawned.stdout ?? "" };
    },
  });
  if (result.skipped !== undefined && result.skipped !== "no-corpus") {
    inv.io.stderr.write(`lore fragments pointers: no pointers emitted (${result.skipped})\n`);
  }
  if (result.text.length > 0) inv.io.stdout.write(result.text);
}

export default defineCommand({
  meta: {
    name: "fragments",
    description:
      "Read-only context-fragment verbs, bootstrap-stage (no corpus DB): " +
      "`render --outlet hook:subagent-start` (hook JSON), " +
      "`check [--json]` (caps, rules-file drift, override refusal, dynamic main fragments, language drift), " +
      "`pointers --cwd P` (project pointer lines).",
  },
  args: {
    action: { type: "positional", description: "render | check | pointers", required: false },
    outlet: { type: "string", description: "render: hook:subagent-start" },
    "agent-type": { type: "string", description: "render: subagent type for hook:subagent-start" },
    cwd: { type: "string", description: "Project directory (default: current directory)" },
    explain: { type: "boolean", description: "render: print per-fragment id/layer/chars to stderr", default: false },
    json: { type: "boolean", description: "check: print the report as JSON", default: false },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const action = typeof args.action === "string" ? args.action : "";
    if (!isAction(action)) {
      return usageError(inv.io, `lore fragments requires an action: ${ACTIONS.join(" | ")} (got "${action}")`);
    }
    const cwd = typeof args.cwd === "string" && args.cwd !== "" ? resolve(args.cwd) : inv.cwd;
    const rest = args as Record<string, unknown>;
    switch (action) {
      case "render":
        return runRender(rest, cwd, inv);
      case "check":
        return runCheck(rest, cwd, inv);
      case "pointers":
        return runPointers(cwd, inv);
      default: {
        const unreachable: never = action;
        throw new Error(`lore fragments: unhandled action ${String(unreachable)}`);
      }
    }
  },
});
