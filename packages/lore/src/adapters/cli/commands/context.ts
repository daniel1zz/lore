/**
 * `lore context list | add | remove <id> [--scope project|user] [--json]` (also in this file) drive the
 * fragment selection (`flows/selection-flow.ts`, spec-rule-store-git-tracked-fragment-selection-on-demand-
 * skill AC-RS-7): `add`/`remove` write the scope's `selection.yaml` (CAS; CONFLICT exits 5, unknown id
 * exits 4) and, only when bytes changed, run `runContextRefresh` for that scope. `refresh` itself folds both
 * `selection.yaml` files, resolves the user config dir with the shared resolver (BR-1065) and passes the
 * embedded manifest's shipped skill names (`buildRefreshFragmentDeps`, also used by `lore setup`).
 *
 * `lore context init | refresh` — the CLI verb family for the two-zone
 * CLAUDE.md capability (spec-context-verb-family-two-zone-claude-md-anatomy-
 * lore, §Public Interface, §Design Decisions D2/D3). Thin adapter over
 * `flows/context-flow.ts`: resolves args, orchestrates the `--ai`/`--no-ai`
 * decision (D2 — this orchestration lives HERE, never inside the flow),
 * builds the real `node:fs`-backed port, calls the flow, renders the result.
 *
 * Positional dispatch, NOT citty `subCommands` (deliberate — see the
 * "Unknown topic exits 2" invariant below for why): `topic` is a single
 * required positional (`init` | `refresh`), validated in this command's own
 * `run` BEFORE any filesystem or AI work. citty's own `subCommands` unknown-
 * command path throws a `CLIError` that `runMain` maps to exit **1**
 * (`E_UNKNOWN_COMMAND` — verified empirically, `citty/dist/index.mjs`'s
 * `runCommand`/`runMain`), which would collide with this task's own AC-CTX-3
 * requirement that an unrecognized topic exit **2** — the SAME "mode-as-
 * first-positional-token, validated against a known set before any real
 * work" pattern `commands/governance.ts` already uses for its own topic
 * registry, applied here for the identical reason.
 *
 * Bootstrap-adjacent, but NOT bootstrap-stage like `commands/setup.ts`/
 * `commands/governance.ts`: this command DOES need an existing `.lore/`
 * corpus (it resolves the repo root via `findLoreDbPath()`, the SAME walk
 * every ordinary corpus command uses) — but it never calls `loadLoreApp()`
 * or touches the corpus DB (SPEC's own "No store/DB dependency anywhere in
 * the context path" module-boundary invariant). Config (`.lore/config.yaml`)
 * is read directly via `@lore/core/node`'s `loadConfig`, ONCE per invocation
 * (both topics — `refresh` included, not just `init`): for `init`'s own
 * `ai.*` section `--ai` orchestration needs, AND (AC-CTX-8) to resolve the
 * effective `context.memory_files.*` budgets via `@lore/core`'s
 * `resolveMemoryFileBudgetsFromConfigResult` — literally the same seam
 * `commands/status.ts`'s `--check-claude-md` calls — threaded into both
 * `runContextRefresh`/`runContextInit`'s `ContextFlowDeps.budgets` and
 * `resolveInitNarrative`'s own facts collection, never re-resolved inline.
 * When that seam reports substituted defaults (an unparseable `context:`
 * block), this command writes the shared stderr notice before doing any work
 * — it WRITES CLAUDE.md against those budgets, so a silent substitution would
 * bake the wrong sizing into the file
 * (task-lore-status-check-claude-md-silently-runs-on-schema).
 *
 * Public surface: default export, a citty `CommandDef`.
 *
 * Invariants:
 *   - Unknown topic (`lore context bogus-topic`) exits 2 with a message
 *     naming the exact offending token, written BEFORE any filesystem/AI
 *     work (see module header above).
 *   - `--ai`/`--no-ai` are mutually exclusive (exit 2) — same tri-state
 *     detection convention as `commands/create.ts` (scans `process.argv`
 *     directly, since citty/mri can't distinguish "flag passed with its
 *     default value" from "flag not passed" for a defaulted boolean).
 *   - AI is attempted ONLY for `init`, and ONLY when the resolved AI default
 *     is on (SPEC-024 surface + config + explicit-flag precedence,
 *     `resolveAiDefault`). ANY failure to produce a usable narrative
 *     (AI off, provider unconfigured, registry build failure, provider
 *     `generate()` failure, empty output) falls back to the flow's own
 *     skeleton placeholder — NEVER a thrown error, NEVER a silent skip: a
 *     stderr warning naming both "skeleton" and "provider" is ALWAYS printed
 *     whenever the narrative ends up unresolved, and the command still
 *     exits 0 (D3).
 *   - `refresh` never reads/resolves `--ai`/`--force` at all — those flags
 *     stay declared (for `init`'s use and for strict-flags discoverability)
 *     but are silently inert for this topic (D2: refresh is Z1-only,
 *     deterministic, never AI).
 *
 * Side-effect class: IO (`node:fs` reads/writes via the real `FsWritePort`
 *   built here, an optional AI provider subprocess spawn via
 *   `buildProviderRegistry`/`AIProvider.generate`, stdout/stderr writes) —
 *   no corpus DB access.
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Design Decisions D2/D3; AC-CTX-3.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import {
  AiConfigSchema,
  formatMemoryFileBudgetSubstitution,
  resolveMemoryFileBudgetsFromConfigResult,
} from "@lore/core";
import { err, isInsideRoots, ok, outsideRootsError } from "@lore/core";
import type { CallerSurface, ContextConfigLayer, FsWritePort, LoreError, MemoryFileBudgets, Result } from "@lore/core";
import { loadConfig, loadGlobalConfig, resolveGlobalConfigPath } from "@lore/core/node";
import { invocationOf } from "../command-invocation.js";
import { exitCode, findLoreDbPath, formatError } from "../utils.js";
import { resolveAssetsRoot, type SetupPathContext } from "../setup-args.js";
import { collectContextFacts } from "../../../service/context-facts.js";
import {
  runContextInit,
  runContextRefresh,
  type ContextInitReport,
  type ContextRefreshReport,
  type ContextRefreshScope,
} from "../../../flows/context-flow.js";
import { buildContextNarrativePrompt } from "../../../ai/context-narrative-template.js";
import { buildProviderRegistry } from "../../../ai/registry.js";
import { resolveAiDefault } from "../../../ai/resolve-ai.js";
import { runSelectionChange, runSelectionList, type SelectionFlowDeps } from "../../../flows/selection-flow.js";
import {
  emptySelection,
  parseSelection,
  SELECTION_FILE,
  selectionToLayer,
  type SelectionScope,
} from "../../../service/context-fragments/selection.js";
import { resolveUserConfigDir } from "../../../service/context-fragments/user-config-dir.js";
import { listShippedSkillNames } from "./fragments.js";

/** The registered `lore context` topics: the CLAUDE.md pair (init, refresh) and the selection trio (list, add, remove). */
type ContextTopic = "init" | "refresh" | "list" | "add" | "remove";
const KNOWN_TOPICS: readonly ContextTopic[] = ["init", "refresh", "list", "add", "remove"];
/** Topics that take `--scope`. */
const SCOPED_TOPICS: readonly ContextTopic[] = ["refresh", "add", "remove"];

/** `--scope` values accepted by `refresh` (spec-context-fragments D4/D15): the repo (CLAUDE.md + `.claude/rules/lore-*.md`) or `~/.claude/rules/lore-*.md`. */
const KNOWN_SCOPES: readonly ContextRefreshScope[] = ["project", "user"];

// reason: dev-mode repo root, 6 levels up from this file — the SAME derivation
// `commands/governance.ts` uses; compiled mode never reads it (`resolveAssetsRoot`
// branches on `isCompiled` and derives from `execPath`), so `lore context refresh`
// and `lore setup` resolve the SAME assets/ tree.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "..");

/**
 * Detects the caller surface for `resolveAiDefault` purposes. A narrow,
 * intentional duplicate of `adapters/cli/loader.ts`'s private
 * `detectCliSurface()` (three env-var checks) — importing `loader.ts` here
 * would pull in `bun:sqlite` transitively (via `app.js`) for a command that
 * otherwise touches no corpus DB at all (module header); redeclaring three
 * stable env-var checks is cheaper than that coupling. See SPEC-024 §8 Q1
 * for the classification rules this mirrors verbatim.
 */
function detectContextCliSurface(env: Readonly<Record<string, string | undefined>>): CallerSurface {
  if (env["LORE_AI_DEFAULT"] === "off" || env["CLAUDECODE"] === "1" || env["CI"] === "true") {
    return "agent";
  }
  return "cli";
}

// reason: the budget-resolution rules this command used to carry as a private
// `resolveContextMemoryFileBudgets` (a byte-identical copy of
// `commands/status.ts`'s own private helper) now live in `@lore/core`'s
// `resolveMemoryFileBudgetsFromConfigResult`. Both copies ended in a bare
// `resolveMemoryFileBudgets(undefined)`, so an unparseable `context:` block
// silently handed BOTH commands schema defaults; consolidating them was the
// fix, because announcing at only one consumer leaves the other lying
// (task-lore-status-check-claude-md-silently-runs-on-schema). ⛔ Do not
// re-inline a local copy here. AC-CTX-8 still holds: the ONE resolution locus
// per invocation is the `run` handler below, whose result is threaded into
// both flows' `ContextFlowDeps` and into `resolveInitNarrative`.

/** The `context.language` / `context.fragments.disable` subset of a loaded config, as a `ContextConfigLayer`. */
export function toContextLayer(
  source:
    | { context?: { language?: string | undefined; fragments?: { disable?: string[] | undefined } | undefined } | undefined }
    | undefined,
): ContextConfigLayer {
  const language = source?.context?.language;
  const disable = source?.context?.fragments?.disable;
  return {
    context: {
      ...(language !== undefined ? { language } : {}),
      ...(disable !== undefined ? { fragments: { disable } } : {}),
    },
  };
}

/**
 * Resolves `path` to the location a write would really land on: the realpath of its deepest EXISTING
 * ancestor (following symlinks, including a dangling link at the target) with the not-yet-existing
 * segments appended. Pure observation — touches nothing.
 */
function resolveWriteLanding(path: string, depth = 0): string {
  const absolute = resolve(path);
  if (depth > 32) return absolute; // reason: a symlink loop — the lexical form stays outside any root unless it is genuinely inside.
  try {
    return realpathSync(absolute);
  } catch {
    // The path (or an ancestor) is missing — or it is a dangling symlink, which realpath also rejects.
  }
  try {
    if (lstatSync(absolute).isSymbolicLink()) {
      return resolveWriteLanding(resolve(dirname(absolute), readlinkSync(absolute)), depth + 1);
    }
  } catch {
    // Not even an lstat-able entry: genuinely absent, climb to the parent below.
  }
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(resolveWriteLanding(parent, depth + 1), basename(absolute));
}

/**
 * Builds a real `node:fs`-backed, ROOTED `FsWritePort` (BR-1177): relative paths resolve against
 * `repoRoot`, and every mutation first checks that its REAL landing spot (symlinks followed, see
 * {@link resolveWriteLanding}) lies inside one of `roots` (also realpath-resolved) — outside any root it
 * returns `err(VALIDATION_ERROR)` and touches nothing, so a target resolved from the wrong home fails loud
 * instead of writing. This is the CLI adapter boundary D9 reserves for the "real implementation" (never
 * `@lore/core`). Reads follow the "collapse ordinary failure, never throw" convention; a genuine disk-write
 * failure inside a root still throws (a real error the caller must see).
 *
 * @param repoRoot - Base for relative paths.
 * @param roots - Directories a write or delete may land under (project root, agent settings folder, ...).
 */
export function makeRealContextFsPort(repoRoot: string, roots: readonly string[]): FsWritePort {
  // reason: the fragment pipeline addresses files OUTSIDE the repo (shipped assets, the XDG
  // user layer, `~/.claude/CLAUDE.md`) by absolute path; `join(repoRoot, "/abs")` would
  // wrongly nest them under the repo, so absolute paths pass through unchanged.
  const resolvePath = (path: string): string => (isAbsolute(path) ? path : join(repoRoot, path));
  const realRoots = roots.map((root) => resolveWriteLanding(root));
  const guard = (path: string, target: string): Result<void, LoreError> =>
    isInsideRoots(resolveWriteLanding(target), realRoots) ? ok(undefined) : err(outsideRootsError(path, roots));
  return {
    async exists(path: string): Promise<boolean> {
      return existsSync(resolvePath(path));
    },
    async readFile(path: string): Promise<string | null> {
      try {
        return readFileSync(resolvePath(path), "utf8");
      } catch {
        return null;
      }
    },
    async listDir(path: string): Promise<string[]> {
      try {
        return readdirSync(resolvePath(path));
      } catch {
        return [];
      }
    },
    async writeFile(path: string, content: string): Promise<Result<void, LoreError>> {
      const target = resolvePath(path);
      const allowed = guard(path, target);
      if (!allowed.ok) return allowed;
      // reason: user scope may create `~/.claude/CLAUDE.md` before `~/.claude/` exists.
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
      return ok(undefined);
    },
    async deleteFile(path: string): Promise<Result<void, LoreError>> {
      const target = resolvePath(path);
      const allowed = guard(path, target);
      if (!allowed.ok) return allowed;
      // reason: `force: true` makes an already-absent file a no-op (the port contract); every
      // other failure (permissions, a directory at the path) stays loud.
      rmSync(target, { force: true });
      return ok(undefined);
    },
    async removeDirIfEmpty(path: string): Promise<Result<void, LoreError>> {
      const target = resolvePath(path);
      const allowed = guard(path, target);
      if (!allowed.ok) return allowed;
      // reason: `rmdir` is the atomic "only if empty" primitive — an absent or non-empty dir is the
      // expected no-op; any other failure (permissions, a file at the path) stays loud.
      try {
        rmdirSync(target);
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") return ok(undefined);
        throw cause;
      }
      return ok(undefined);
    },
  };
}

/**
 * Resolves the Z2 narrative text for `context init` — attempts an AI call
 * only when `useAi` is true, and NEVER throws: any failure along the way
 * (registry build, missing active provider, `generate()` failure, empty
 * output) resolves to `undefined`, which the flow interprets as "use the
 * skeleton placeholder" (D3).
 *
 * @param budgets - This invocation's already-resolved
 *   `resolveMemoryFileBudgetsFromConfigResult(...).budgets` value — threaded
 *   in rather than re-resolved here so a single `lore context init` call has
 *   exactly ONE budgets resolution locus (AC-CTX-8), shared with the
 *   `runContextInit` call this function's caller makes right after.
 */
async function resolveInitNarrative(
  fsPort: FsWritePort,
  repoRoot: string,
  useAi: boolean,
  aiConfig: ReturnType<typeof AiConfigSchema.parse>,
  budgets: MemoryFileBudgets,
): Promise<string | undefined> {
  if (!useAi) return undefined;

  const factsResult = await collectContextFacts(fsPort, "", budgets);
  if (!factsResult.ok) return undefined;

  const registryResult = buildProviderRegistry(aiConfig);
  if (!registryResult.ok) return undefined;

  const provider = registryResult.value.providers.get(registryResult.value.active);
  if (provider === undefined) return undefined;

  const genResult = await provider.generate({
    prompt: buildContextNarrativePrompt(factsResult.value),
    doc_type: "knowledge",
    title: "CLAUDE.md context narrative",
  });
  if (!genResult.ok) return undefined;

  const content = genResult.value.content.trim();
  return content.length > 0 ? content : undefined;
}

/** Renders a `ContextInitReport`/`ContextRefreshReport`'s per-section outcome, one line each. */
function renderSections(sections: ReadonlyArray<{ id: string; state: string }>): void {
  for (const section of sections) {
    console.log(`  ${section.id}: ${section.state}`);
  }
}

/** Writes the final error/success result of an init/refresh run and sets `process.exitCode` — shared by both topics. */
function renderOutcome(
  json: boolean,
  result: { ok: true; value: ContextInitReport | ContextRefreshReport } | { ok: false; error: LoreError },
): void {
  if (!result.ok) {
    process.stderr.write(formatError(result.error) + "\n");
    process.exitCode = exitCode(result.error);
    return;
  }

  if (json) {
    console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
    return;
  }

  const check = "check" in result.value ? result.value.check : null;
  if (check !== null) {
    // --check: nothing was written; exit 1 names each file that would change and/or the ceiling breach (AC-MI-3).
    if (check.differing.length === 0 && check.ceilingBreach === null) {
      console.log("context refresh --check: every target is already refreshed and within its ceiling");
      return;
    }
    for (const path of check.differing) console.log(`would change: ${path}`);
    if (check.ceilingBreach !== null) console.log(`ceiling: ${check.ceilingBreach}`);
    process.exitCode = 1;
    return;
  }

  const narrativeSuffix = "narrative" in result.value ? ` (narrative: ${result.value.narrative})` : "";
  console.log(`Wrote ${result.value.path}${narrativeSuffix}`);
  for (const block of result.value.migratedLegacyBlocks) {
    console.log(`  migrated legacy block ${block} into the managed zone`);
  }
  renderSections(result.value.sections);
  if ("rules" in result.value) {
    for (const rule of result.value.rules) {
      console.log(`  ${rule.path}: ${rule.state}`);
    }
  }
  // AC-STR-6: adoption=warn advisories (refresh only) — stderr so stdout stays the outcome list.
  if ("downgraded" in result.value) {
    for (const finding of result.value.downgraded) {
      process.stderr.write(`Advisory: ${finding.message}\n`);
    }
  }
}

/** Raw text of one selection file; `null` when absent (legitimate); an unreadable file fails loud. */
function readSelectionText(path: string): Result<string | null, LoreError> {
  if (!existsSync(path)) return ok(null);
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (cause) {
    return err({ code: "VALIDATION_ERROR", field: "path", message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}`, value: path });
  }
}

/**
 * Folds both scopes' `selection.yaml` into the project/global config layers (BR-1062) so refresh
 * selects fragments exactly as `lore fragments check` does: the selection file, not the settings file,
 * owns the disable list. A malformed selection file, or a settings-file disable list, is a
 * VALIDATION_ERROR (never silently ignored).
 */
export function foldSelections(opts: {
  repoRoot: string;
  userConfigDir: string;
  globalLayer: ContextConfigLayer;
  projectLayer: ContextConfigLayer;
}): Result<{ globalConfig: ContextConfigLayer; projectConfig: ContextConfigLayer }, LoreError> {
  const folded: Record<SelectionScope, ContextConfigLayer> = { user: opts.globalLayer, project: opts.projectLayer };
  const sources: Record<SelectionScope, string> = {
    user: join(opts.userConfigDir, SELECTION_FILE.user),
    project: join(opts.repoRoot, SELECTION_FILE.project),
  };
  for (const scope of ["user", "project"] as const) {
    const text = readSelectionText(sources[scope]);
    if (!text.ok) return text;
    const selection = text.value === null ? ok(emptySelection()) : parseSelection(text.value, sources[scope]);
    if (!selection.ok) return selection;
    const layer = selectionToLayer(selection.value, folded[scope], scope);
    if (!layer.ok) return layer;
    folded[scope] = layer.value;
  }
  return ok({ globalConfig: folded.user, projectConfig: folded.project });
}

/**
 * The fragment deps `runContextRefresh` needs, shared by `lore context` and `lore setup --project`:
 * user config dir from the shared resolver (BR-1065), both selection files folded in, and the shipped
 * skill names from the embedded manifest (BR-1064) so a fragment can never shadow a shipped skill.
 */
export function buildRefreshFragmentDeps(opts: {
  repoRoot: string;
  assetsRoot: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  globalLayer: ContextConfigLayer;
  projectLayer: ContextConfigLayer;
}): Result<
  {
    assetsRoot: string;
    home: string;
    xdgConfigHome: string;
    userConfigDir: string;
    globalConfig: ContextConfigLayer;
    projectConfig: ContextConfigLayer;
    shippedSkillNames: string[];
  },
  LoreError
> {
  const userConfigDir = resolveUserConfigDir(opts.env, opts.home);
  const layers = foldSelections({ repoRoot: opts.repoRoot, userConfigDir, globalLayer: opts.globalLayer, projectLayer: opts.projectLayer });
  if (!layers.ok) return layers;
  return ok({
    assetsRoot: opts.assetsRoot,
    home: opts.home,
    // reason: still required by the flow's all-or-nothing dep check; `userConfigDir` is what it reads.
    xdgConfigHome: opts.env["XDG_CONFIG_HOME"] || join(opts.home, ".config"),
    userConfigDir,
    globalConfig: layers.value.globalConfig,
    projectConfig: layers.value.projectConfig,
    shippedSkillNames: listShippedSkillNames(),
  });
}

function reportFailure(error: LoreError): void {
  process.stderr.write(formatError(error) + "\n");
  process.exitCode = exitCode(error);
}

export default defineCommand({
  meta: {
    name: "context",
    description: "Manage the two-zone project CLAUDE.md (init | refresh) — SPEC-context-verb-family",
  },
  args: {
    topic: {
      type: "positional",
      description: "Context subcommand: init | refresh | list | add | remove",
      required: false,
    },
    id: {
      type: "positional",
      description: "[add | remove only] Fragment id to re-enable (add) or disable (remove)",
      required: false,
    },
    force: {
      type: "boolean",
      description: "[init only] Bypass the 'already initialized' refusal when CLAUDE.md already exists",
    },
    ai: {
      type: "boolean",
      // reason: SPEC-024 tri-state AI flag, SAME convention as commands/create.ts —
      // no default here; the real --ai/--no-ai/neither detection scans process.argv
      // (see run handler) since citty/mri can't distinguish "flag absent" from
      // "flag passed with its default value" for a defaulted boolean.
      description: "[init only] Explicitly enable AI-generated Z2 narrative (overrides surface default). Pass --no-ai to disable.",
    },
    scope: {
      type: "string",
      description: "[refresh | add | remove] Scope: project (default; repo CLAUDE.md + .claude/rules/lore-*.md + .lore/context/selection.yaml) | user (~/.claude/rules/lore-*.md + the user config dir selection.yaml)",
    },
    check: {
      type: "boolean",
      description: "[refresh only] Compute the refresh and write nothing: exit 0 only when every target already equals its refreshed content and the root CLAUDE.md is within its ceiling, else exit 1 naming each differing file / the ceiling",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const topic = typeof args.topic === "string" ? args.topic : undefined;

    if (topic === undefined) {
      process.stderr.write(`Error: lore context requires a topic (expected: ${KNOWN_TOPICS.join(" | ")})\n`);
      process.exitCode = 2;
      return;
    }
    if (!KNOWN_TOPICS.includes(topic as ContextTopic)) {
      process.stderr.write(`Error: unknown context topic "${topic}" (expected: ${KNOWN_TOPICS.join(" | ")})\n`);
      process.exitCode = 2;
      return;
    }

    const scopeArg = typeof args.scope === "string" ? args.scope : undefined;
    if (scopeArg !== undefined && (!SCOPED_TOPICS.includes(topic as ContextTopic) || !KNOWN_SCOPES.includes(scopeArg as ContextRefreshScope))) {
      const reason =
        !SCOPED_TOPICS.includes(topic as ContextTopic)
          ? "--scope applies to `refresh`, `add` and `remove` only"
          : `unknown --scope "${scopeArg}" (expected: ${KNOWN_SCOPES.join(" | ")})`;
      process.stderr.write(`Error: ${reason}\n`);
      process.exitCode = 2;
      return;
    }

    if (args.check === true && topic !== "refresh") {
      process.stderr.write("Error: --check applies to `refresh` only\n");
      process.exitCode = 2;
      return;
    }

    const dbPath = findLoreDbPath();
    const repoRoot = dirname(dirname(dbPath));
    const json = args.json === true;

    // ONE config load + budgets resolution per invocation (AC-CTX-8) — reused
    // below by `init`'s AI-orchestration config needs (`config?.ai?.*`) as well
    // as by both verbs' `ContextFlowDeps.budgets` and `resolveInitNarrative`'s
    // facts collection. Resolution rules live in `@lore/core`'s
    // `resolveMemoryFileBudgetsFromConfigResult` — see its doc.
    const configResult = loadConfig(repoRoot);
    const config = configResult.ok ? configResult.value : undefined;
    const budgetResolution = resolveMemoryFileBudgetsFromConfigResult(configResult);
    const budgets = budgetResolution.budgets;
    // reason: this command WRITES CLAUDE.md against these budgets, so running
    // on silently substituted ceilings would bake the wrong Zone-1 sizing into
    // the file itself. Emitted before any write, on stderr so `--json` stdout
    // stays a clean payload.
    const substitutionNotice = formatMemoryFileBudgetSubstitution(budgetResolution, repoRoot);
    if (substitutionNotice !== undefined) process.stderr.write(substitutionNotice + "\n");

    const home = inv.paths.home;
    const globalConfigResult = loadGlobalConfig(resolveGlobalConfigPath(inv.env, home));
    if (!globalConfigResult.ok) {
      process.stderr.write(formatError(globalConfigResult.error) + "\n");
      process.exitCode = exitCode(globalConfigResult.error);
      return;
    }
    const userConfigDir = resolveUserConfigDir(inv.env, home);
    // reason: BR-1177 — writes may land only in the project, the agent settings folder (rules, skills) and
    // the user config layer (user-scope selection file); a target resolved from the wrong home is refused.
    const fsPort = makeRealContextFsPort(repoRoot, [repoRoot, join(home, ".claude"), userConfigDir]);
    const pathCtx: SetupPathContext = {
      repoRoot: REPO_ROOT,
      isCompiled: inv.isCompiled,
      execPath: inv.execPath,
    };
    const assetsRoot = resolveAssetsRoot(pathCtx);
    const scope: ContextRefreshScope = (scopeArg as ContextRefreshScope | undefined) ?? "project";
    // reason: init and refresh receive identical deps; only refresh consumes the fragment deps (it owns the
    // lore rules files, D15), so "init then refresh" leaves CLAUDE.md byte-identical (AC-CTX-3). Built on
    // demand because the selection files are folded in at build time and `add`/`remove` rewrite them
    // before refreshing.
    const buildFragmentDeps = () =>
      buildRefreshFragmentDeps({
        repoRoot,
        assetsRoot,
        home,
        env: inv.env,
        globalLayer: toContextLayer(globalConfigResult.value),
        projectLayer: toContextLayer(config),
      });

    if (topic === "refresh") {
      const fragmentDeps = buildFragmentDeps();
      if (!fragmentDeps.ok) return reportFailure(fragmentDeps.error);
      const result = await runContextRefresh({ fs: fsPort, budgets, ...fragmentDeps.value }, "", { scope, check: args.check === true });
      renderOutcome(json, result);
      // reason: --json prints the report (incl. `check`) and returns before the plain-text exit mapping, so the
      // exit-1 contract for a drifted/over-ceiling --check is applied here for both output modes.
      if (args.check === true && result.ok && result.value.check !== null) {
        const { differing, ceilingBreach } = result.value.check;
        if (differing.length > 0 || ceilingBreach !== null) process.exitCode = 1;
      }
      return;
    }

    if (topic === "list" || topic === "add" || topic === "remove") {
      const selectionDeps: SelectionFlowDeps = {
        fs: fsPort,
        roots: {
          shipped: join(assetsRoot, "context"),
          user: join(userConfigDir, "context"),
          project: join(repoRoot, ".lore", "context"),
        },
        selectionPaths: {
          project: join(repoRoot, SELECTION_FILE.project),
          user: join(userConfigDir, SELECTION_FILE.user),
        },
      };

      if (topic === "list") {
        const listed = await runSelectionList(selectionDeps);
        if (!listed.ok) return reportFailure(listed.error);
        if (json) {
          console.log(JSON.stringify({ ok: true, data: listed.value }, null, 2));
          return;
        }
        for (const row of listed.value) {
          console.log(`${row.selected ? "on " : "off"}  ${row.id}  (${row.layer}, ${row.delivery}, ${row.size} chars)`);
        }
        return;
      }

      const id = typeof args.id === "string" ? args.id : "";
      if (id === "") {
        process.stderr.write(`Error: lore context ${topic} requires a fragment id (lore context ${topic} <id> [--scope project|user])\n`);
        process.exitCode = 2;
        return;
      }
      const changed = await runSelectionChange(selectionDeps, { action: topic, id, scope });
      if (!changed.ok) return reportFailure(changed.error);

      // reason: a no-op change (the file already held the resulting bytes) skips the refresh, so a
      // repeat `remove` leaves every file byte-identical (BR-1063 idempotence).
      let refreshed: Awaited<ReturnType<typeof runContextRefresh>> | null = null;
      if (changed.value.changed) {
        const fragmentDeps = buildFragmentDeps();
        if (!fragmentDeps.ok) return reportFailure(fragmentDeps.error);
        refreshed = await runContextRefresh({ fs: fsPort, budgets, ...fragmentDeps.value }, "", { scope });
      }
      if (refreshed !== null && !refreshed.ok) {
        // The selection write already landed; say so before the refresh error so a retry is obvious.
        process.stderr.write(`Recorded ${changed.value.path}, but the refresh failed:\n`);
        return reportFailure(refreshed.error);
      }
      if (json) {
        console.log(
          JSON.stringify({ ok: true, data: { change: changed.value, refresh: refreshed === null ? null : refreshed.value } }, null, 2),
        );
        return;
      }
      const verb = topic === "remove" ? "Disabled" : "Enabled";
      console.log(
        `${verb} "${id}" in the ${scope} selection (${changed.value.path})${changed.value.changed ? "" : " — already so, nothing changed"}`,
      );
      if (refreshed !== null && refreshed.ok) renderOutcome(false, refreshed);
      return;
    }

    // topic === "init"
    const rawArgv = inv.argv;
    const hasExplicitAi = rawArgv.includes("--ai");
    const hasExplicitNoAi = rawArgv.includes("--no-ai");
    if (hasExplicitAi && hasExplicitNoAi) {
      process.stderr.write("Error: --ai and --no-ai are mutually exclusive. Pass only one.\n");
      process.exitCode = 2;
      return;
    }
    const explicitAi: boolean | undefined = hasExplicitAi
      ? true
      : hasExplicitNoAi
        ? false
        : (args.ai as boolean | undefined);

    const surface = detectContextCliSurface(inv.env);
    const { ai: useAi } = resolveAiDefault(explicitAi, surface, config?.ai?.default_per_surface);
    const aiConfig = config?.ai ?? AiConfigSchema.parse({});

    const narrative = await resolveInitNarrative(fsPort, repoRoot, useAi, aiConfig, budgets);
    if (narrative === undefined) {
      process.stderr.write(
        "Warning: no usable AI provider — writing a skeleton narrative placeholder instead of an AI-generated one.\n",
      );
    }

    const initDeps = buildFragmentDeps();
    if (!initDeps.ok) return reportFailure(initDeps.error);
    const result = await runContextInit(
      { fs: fsPort, budgets, ...initDeps.value },
      "",
      narrative !== undefined ? { narrative, force: args.force === true } : { force: args.force === true },
    );
    renderOutcome(json, result);
  },
});
