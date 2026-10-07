/**
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

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import {
  AiConfigSchema,
  formatMemoryFileBudgetSubstitution,
  resolveMemoryFileBudgetsFromConfigResult,
} from "@lore/core";
import type { CallerSurface, FsWritePort, LoreError, MemoryFileBudgets } from "@lore/core";
import { loadConfig } from "@lore/core/node";
import { exitCode, findLoreDbPath, formatError } from "../utils.js";
import { collectContextFacts } from "../../../service/context-facts.js";
import { runContextInit, runContextRefresh, type ContextInitReport, type ContextRefreshReport } from "../../../flows/context-flow.js";
import { buildContextNarrativePrompt } from "../../../ai/context-narrative-template.js";
import { buildProviderRegistry } from "../../../ai/registry.js";
import { resolveAiDefault } from "../../../ai/resolve-ai.js";

/** The two registered `lore context` topics. */
type ContextTopic = "init" | "refresh";
const KNOWN_TOPICS: readonly ContextTopic[] = ["init", "refresh"];

/**
 * Detects the caller surface for `resolveAiDefault` purposes. A narrow,
 * intentional duplicate of `adapters/cli/loader.ts`'s private
 * `detectCliSurface()` (three env-var checks) — importing `loader.ts` here
 * would pull in `bun:sqlite` transitively (via `app.js`) for a command that
 * otherwise touches no corpus DB at all (module header); redeclaring three
 * stable env-var checks is cheaper than that coupling. See SPEC-024 §8 Q1
 * for the classification rules this mirrors verbatim.
 */
function detectContextCliSurface(): CallerSurface {
  if (
    process.env["LORE_AI_DEFAULT"] === "off" ||
    process.env["CLAUDECODE"] === "1" ||
    process.env["CI"] === "true"
  ) {
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

/**
 * Builds a real `node:fs`-backed `FsWritePort` rooted at `repoRoot` — the
 * CLI adapter boundary D9 reserves for the "real implementation" (never
 * `@lore/core`, never `service/context-facts.ts`/`flows/context-flow.ts`
 * themselves). Mirrors `adapters/real-fs-probe.ts`'s "collapse ordinary
 * failure, never throw" convention for the three read methods; `writeFile`
 * is the one method allowed to throw (a genuine disk-write failure is a
 * real error the caller must see, not silently swallow).
 */
function buildRealFsPort(repoRoot: string): FsWritePort {
  return {
    async exists(path: string): Promise<boolean> {
      return existsSync(join(repoRoot, path));
    },
    async readFile(path: string): Promise<string | null> {
      try {
        return readFileSync(join(repoRoot, path), "utf8");
      } catch {
        return null;
      }
    },
    async listDir(path: string): Promise<string[]> {
      try {
        return readdirSync(join(repoRoot, path));
      } catch {
        return [];
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      writeFileSync(join(repoRoot, path), content, "utf8");
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

  const narrativeSuffix = "narrative" in result.value ? ` (narrative: ${result.value.narrative})` : "";
  console.log(`Wrote ${result.value.path}${narrativeSuffix}`);
  renderSections(result.value.sections);
  // AC-STR-6: adoption=warn advisories (refresh only) — stderr so stdout stays the outcome list.
  if ("downgraded" in result.value) {
    for (const finding of result.value.downgraded) {
      process.stderr.write(`Advisory: ${finding.message}\n`);
    }
  }
}

export default defineCommand({
  meta: {
    name: "context",
    description: "Manage the two-zone project CLAUDE.md (init | refresh) — SPEC-context-verb-family",
  },
  args: {
    topic: {
      type: "positional",
      description: "Context subcommand: init | refresh",
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
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
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

    const dbPath = findLoreDbPath();
    const repoRoot = dirname(dirname(dbPath));
    const fsPort = buildRealFsPort(repoRoot);
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

    if (topic === "refresh") {
      const result = await runContextRefresh({ fs: fsPort, budgets }, "");
      renderOutcome(json, result);
      return;
    }

    // topic === "init"
    const rawArgv = process.argv.slice(2);
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

    const surface = detectContextCliSurface();
    const { ai: useAi } = resolveAiDefault(explicitAi, surface, config?.ai?.default_per_surface);
    const aiConfig = config?.ai ?? AiConfigSchema.parse({});

    const narrative = await resolveInitNarrative(fsPort, repoRoot, useAi, aiConfig, budgets);
    if (narrative === undefined) {
      process.stderr.write(
        "Warning: no usable AI provider — writing a skeleton narrative placeholder instead of an AI-generated one.\n",
      );
    }

    const result = await runContextInit(
      { fs: fsPort, budgets },
      "",
      narrative !== undefined ? { narrative, force: args.force === true } : { force: args.force === true },
    );
    renderOutcome(json, result);
  },
});
