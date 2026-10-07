/**
 * `lore context init` / `lore context refresh` orchestration (SPEC-context-
 * verb-family-two-zone-claude-md-anatomy-lore, §Design Decisions D1/D2/D3/D5).
 * Bridges `service/context-facts.ts` (facts collection) and
 * `service/context-projection.ts` (pure parse/render/splice) into the two
 * writer verbs the CLI adapter (`adapters/cli/commands/context.ts`) calls.
 * Facts -> `ManagedSection[]` rendering happens HERE, not in
 * `context-projection.ts` (that module's own `renderManagedSections` is a
 * documented narrow pass-through owned by a sibling task — this file never
 * edits it, it builds sections itself and hands them straight to
 * `spliceManagedSections`).
 *
 * Public surface:
 *   - ContextInitReport / ContextRefreshReport — per-call outcome reports
 *   - ContextFlowDeps — `{ fs: FsWritePort }` plus optional budgets and the
 *     optional fragment-pipeline deps (`FragmentRefreshDeps`, all injected)
 *   - runContextInit(deps, root, opts) — first-write / re-init verb
 *   - runContextRefresh(deps, root, opts?) — Z1-only regeneration verb;
 *     `opts.scope` = "project" (default, repo CLAUDE.md) | "user"
 *     (`<home>/.claude/CLAUDE.md`)
 *
 * Invariants:
 *   - `runContextRefresh` NEVER calls any AI provider and NEVER touches Z2
 *     bytes outside the managed zone (D2/D5) — it only ever regenerates the
 *     Z1 zone via `spliceManagedSections`, which already guarantees Z2
 *     byte-preservation and `diverged_skip` on a hand-edited section
 *     (`service/context-projection.ts`'s own invariants, reused verbatim,
 *     never re-implemented here).
 *   - Z1 `fragments` section (spec-context-fragments D4/D8/D11/D14, AC-CF-6/13/15):
 *     when `FragmentRefreshDeps` are supplied, refresh runs discover ->
 *     checkOverrides -> selectFragments(outlet claude-md:<scope>) -> renderOutlet ->
 *     buildFragmentsSection and splices the result as one more managed section.
 *     Only PART of the fragment deps supplied = loud VALIDATION_ERROR (never a
 *     silent skip); NONE supplied = legacy `{ fs }` callers, project scope only
 *     (scope "user" with none is an error). Scope "user" splices ONLY the
 *     fragments section into `<home>/.claude/CLAUDE.md`, so bytes outside the lore
 *     markers are never touched; an absent user file is created.
 *   - Compare-and-swap write (D8, AC-CF-13): refresh hashes the bytes it read,
 *     re-reads right before writing and writes ONLY if the hash is unchanged;
 *     otherwise it returns `err(CONFLICT)` with ZERO writes. Residual window:
 *     between that re-read and `writeFile` the `FsWritePort` has no atomic
 *     primitive, so the race is narrowed to one read-to-write gap, not eliminated.
 *   - Adoption (AC-STR-6): `runContextRefresh` honours `deps.budgets.adoption`
 *     only through `runMemoryFileChecks` (it applies adoption). enforce -> a
 *     `section_*` finding is in `.deterministic` and refuses the write naming
 *     its kind + section (message of each finding); warn (or absent) ->
 *     `.deterministic` is empty, the file is written, and the `downgraded`
 *     advisories are returned on `ContextRefreshReport.downgraded`.
 *   - `runContextInit` NEVER calls any AI provider either — `opts.narrative`
 *     is an ALREADY-RESOLVED string (or absent). Resolving whether to call
 *     AI, and rendering the narrative-compression prompt if so, is the CLI
 *     adapter's job (D2/D3) — this module is deterministic and
 *     black-box-testable with a plain string input.
 *   - A pre-existing `CLAUDE.md` makes `runContextInit` refuse (loud
 *     `VALIDATION_ERROR` naming both `lore context refresh` and `--force`)
 *     UNLESS `opts.force` is `true` — this is a "did you mean refresh?"
 *     guard, NOT the only thing protecting existing hand-written content:
 *     even under `--force`, `spliceManagedSections` still independently
 *     preserves every Z2 byte and reports `diverged_skip` for a hand-edited
 *     section (the guard only lifts the "already initialized" refusal, it
 *     never disables the splice's own safety).
 *   - `opts.narrative` is applied ONLY when no `CLAUDE.md` exists yet (a
 *     fresh file) — when one already exists (the `--force` re-init path),
 *     its current Z2 bytes are reused verbatim and `opts.narrative` is
 *     silently ignored (report.narrative reflects this as `"existing"`,
 *     never silently mislabeled `"generated"`/`"skeleton"`).
 *   - Both verbs write a file that always ends in exactly one trailing
 *     `"\n"` (`ensureTrailingNewline`) — applied AFTER the splice, so an
 *     unchanged re-splice (refresh with no drift) stays byte-identical
 *     across repeated calls (idempotent: the helper only adds a newline
 *     when one isn't already there).
 *   - Both verbs resolve `collectContextFacts`'s budgets via
 *     `resolveFlowBudgets(deps)`: `deps.budgets` when the CLI adapter
 *     (`adapters/cli/commands/context.ts`) threaded one (config-aware,
 *     mirroring `commands/status.ts`'s own `.lore/config.yaml` resolution —
 *     AC-CTX-8: "same budget source as `lore status --check-claude-md`"),
 *     else `resolveMemoryFileBudgets(undefined)` (schema defaults) —
 *     `ContextFlowDeps` still carries no `LoreConfig`/store dependency
 *     itself (D9: "keeps this module vitest-testable with plain fakes");
 *     the CLI adapter is the ONE locus that ever reads `.lore/config.yaml`
 *     for this invocation, this module only ever consumes the already-
 *     resolved `MemoryFileBudgets` value it was handed.
 *   - `runContextRefresh` pre-write admission (AC-CTX-8, root cause:
 *     knowledge-retro-context-refresh-module-index-walk-pollutes): AFTER
 *     splicing and appending the trailing newline but BEFORE calling
 *     `deps.fs.writeFile`, the spliced candidate is run through
 *     `service/claude-md-admission.ts`'s `runMemoryFileChecks` — the SAME
 *     SOLE composition entry `lore status --check-claude-md` consumes (SSOT:
 *     never a second inline size check here, and never a direct call into
 *     the underlying capacity lint — AC-COMPOSE-1, spec-claude-md-
 *     governance-content-dimension-checks-wire-the) — against the SAME
 *     `resolveFlowBudgets(deps)`
 *     value `collectContextFacts` already used for this call (never a second,
 *     independently-resolved budgets value). Only the DETERMINISTIC half of
 *     the result gates the write (root role, `max_lines` or `max_bytes`);
 *     any such finding refuses the whole call with `err(VALIDATION_ERROR)`
 *     naming every breach and performs NO write — a within-budget splice is
 *     unaffected (byte-identical to pre-check behavior). The ADVISORY half
 *     (dangling references, narrative smells) is computed and discarded —
 *     `runMemoryFileChecks` never lets an advisory finding refuse a write,
 *     matching every other consumer of this mechanism — so the
 *     `fileExists`/`docExists` predicates this call supplies are inert
 *     stand-ins (this verb reports no reference/slug advisories; that
 *     surface is `lore status --check-claude-md`'s job). `runContextInit`
 *     does NOT run this check: its own already-exists refusal is the
 *     narrower, pre-existing guard for that verb (out of this AC's scope),
 *     and `--force` (init-only) never bypasses `runContextRefresh`'s check
 *     either, since refresh has no `--force` option to bypass with.
 *
 * Side-effect class: IO (exclusively via the injected `FsWritePort`)
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Design Decisions D1/D2/D3/D5.
 */

import { createHash } from "node:crypto";
import { err, ok, resolveContextConfig, resolveMemoryFileBudgets } from "@lore/core";
import type { ContextConfigLayer, FsWritePort, LoreError, MemoryFileBudgets, OutletId, Result } from "@lore/core";
import type { AdvisoryFinding } from "../service/claude-md-findings.js";
import { collectContextFacts, type ContextFacts } from "../service/context-facts.js";
import { runMemoryFileChecks } from "../service/claude-md-admission.js";
import { spliceManagedSections, type ManagedSection, type SpliceResult } from "../service/context-projection.js";
import { discoverFragments } from "../service/context-fragments/discover.js";
import { renderOutlet } from "../service/context-fragments/render.js";
import { buildFragmentsSection } from "../service/context-fragments/section.js";
import { checkOverrides, selectFragments } from "../service/context-fragments/select.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Repo-relative path every `context` verb reads/writes — the root project memory file. */
const CLAUDE_MD_PATH = "CLAUDE.md";

/** Section ids this module renders, in the order they appear in the managed zone. */
const MODULE_INDEX_SECTION_ID = "module-index";
const COMMAND_TABLE_SECTION_ID = "command-table";
const GOVERNANCE_POINTER_SECTION_ID = "governance-pointer";
const SPEC_DISCOVERY_POINTER_SECTION_ID = "spec-discovery-pointer";

/**
 * Minimal Z2 placeholder narrative written on a fresh `context init` when no
 * `opts.narrative` was resolved (D3: "skeleton" fallback) — deliberately
 * short and self-describing, never a hostage to AI availability.
 */
const SKELETON_NARRATIVE =
  "# Project Discipline\n\n" +
  "_(placeholder — describe this project's standing rules, prohibitions, and thresholds here.\n" +
  "The sections below this point are lore-managed: they regenerate automatically via\n" +
  "`lore context refresh` and should not be hand-edited.)_\n";

// ─── Public shapes ──────────────────────────────────────────────────────────

/**
 * Injected inputs of the fragment pipeline (spec-context-fragments "Deps (all injected)").
 * Paths may be absolute (the real port passes absolute paths through) or relative to the
 * port's root.
 */
export interface FragmentRefreshDeps {
  /** Shipped fragments live at `<assetsRoot>/context/*.md`. */
  assetsRoot: string;
  /** Home directory; the user-scope target is `<home>/.claude/CLAUDE.md`. */
  home: string;
  /** User-layer fragments live at `<xdgConfigHome>/lore/context/*.md`. */
  xdgConfigHome: string;
  /** Raw global (XDG) config layer. */
  globalConfig: ContextConfigLayer;
  /** Raw project (`.lore/config.yaml`) config layer. */
  projectConfig: ContextConfigLayer;
}

/** Which memory file a refresh targets. */
export type ContextRefreshScope = "project" | "user";

/** Options accepted by {@link runContextRefresh}. */
export interface ContextRefreshOptions {
  /** Defaults to "project". */
  scope?: ContextRefreshScope;
}

/** The dependency bundle every context-flow verb takes — see module header's "no config/store" invariant. */
export interface ContextFlowDeps extends Partial<FragmentRefreshDeps> {
  fs: FsWritePort;
  /**
   * Resolved `context.memory_files.*` budgets for this invocation — threaded
   * in by the CLI adapter (config-aware, AC-CTX-8: same source as `lore
   * status --check-claude-md`). Optional so existing callers that construct
   * `{ fs }` alone (this module's own vitest suite, any other in-process
   * caller) keep resolving to schema defaults unchanged — see
   * {@link resolveFlowBudgets}.
   */
  budgets?: MemoryFileBudgets;
}

/**
 * Resolves the effective budgets for one `runContextInit`/`runContextRefresh`
 * call: `deps.budgets` when the caller threaded one, else schema defaults
 * (`resolveMemoryFileBudgets(undefined)`) — the ONE fallback locus both verbs
 * share, so `collectContextFacts` and the AC-CTX-8 admission check (refresh
 * only) are never resolved against two different values in the same call.
 */
function resolveFlowBudgets(deps: ContextFlowDeps): MemoryFileBudgets {
  return deps.budgets ?? resolveMemoryFileBudgets(undefined);
}

/** Options accepted by {@link runContextInit}. */
export interface ContextInitOptions {
  /** Already-resolved narrative text (from an AI call the CLI adapter made), or absent for the skeleton fallback. Ignored when `CLAUDE.md` already exists (see module header). */
  narrative?: string;
  /** Bypasses the "already initialized" refusal when `CLAUDE.md` already exists — does NOT disable `spliceManagedSections`'s own Z2/diverged_skip safety (module header). */
  force?: boolean;
}

/** How the Z2 narrative placeholder was resolved for one `runContextInit` call. */
export type ContextNarrativeOutcome = "generated" | "skeleton" | "existing";

/** Outcome of one {@link runContextInit} call. */
export interface ContextInitReport {
  /** Repo-relative path written — always {@link CLAUDE_MD_PATH}. */
  path: string;
  narrative: ContextNarrativeOutcome;
  sections: SpliceResult["perSection"];
}

/** Outcome of one {@link runContextRefresh} call. */
export interface ContextRefreshReport {
  /** Path written: {@link CLAUDE_MD_PATH} (project scope) or `<home>/.claude/CLAUDE.md` (user scope). */
  path: string;
  sections: SpliceResult["perSection"];
  /**
   * Advisory `downgraded` findings from adoption=warn (spec-claude-md-root-
   * section-structure-check-and-adoption-mode D2, AC-STR-6): deterministic
   * findings that WOULD have refused this write under enforce, each carrying
   * `downgraded_kind` (e.g. `section_missing`). Always present; empty when the
   * candidate conforms or adoption=enforce (where such findings refuse instead).
   */
  downgraded: AdvisoryFinding[];
}

// ─── Rendering (facts -> ManagedSection[]) ──────────────────────────────────

/** Renders the module-index section body from {@link ContextFacts.moduleIndex}. */
function renderModuleIndexBody(facts: ContextFacts): string {
  if (facts.moduleIndex.length === 0) {
    return "No nested module directories were discovered.";
  }
  const lines = facts.moduleIndex.map(
    (entry) => `- \`${entry.path}\`${entry.hasMemoryFile ? " — has its own memory file" : " — no memory file yet"}`,
  );
  return ["Module index (auto-discovered):", ...lines].join("\n");
}

/** Renders the command-table section body from {@link ContextFacts.commands}. */
function renderCommandTableBody(facts: ContextFacts): string {
  const entries = Object.entries(facts.commands);
  if (entries.length === 0) {
    return "No package.json scripts were discovered.";
  }
  const lines = entries.map(([name, command]) => `- \`${name}\`: \`${command}\``);
  return ["Commands (from package.json scripts):", ...lines].join("\n");
}

/** Renders the governance-pointer section body — static pointer text, no facts needed. */
function renderGovernancePointerBody(): string {
  return (
    "Run `lore governance claude-md` for this project's memory-file content contract. The standing " +
    "corpus-workflow discipline lives in the `fragments` section of this managed zone (inspect it with " +
    "`lore fragments`)."
  );
}

/** Renders the spec-discovery-pointer section body — static pointer text, no facts needed. */
function renderSpecDiscoveryPointerBody(): string {
  return (
    'Specs are not filed in this document — discover them via `lore search "<topic>"`, ' +
    "`lore tree`, or `lore get <spec-slug>`."
  );
}

/**
 * Renders `facts` into the ordered `ManagedSection[]` passed to
 * `spliceManagedSections` — the "Facts -> ManagedSection[] rendering" this
 * module's header says happens HERE, not in `context-projection.ts`.
 */
function renderContextSections(facts: ContextFacts): ManagedSection[] {
  return [
    { id: MODULE_INDEX_SECTION_ID, body: renderModuleIndexBody(facts) },
    { id: COMMAND_TABLE_SECTION_ID, body: renderCommandTableBody(facts) },
    { id: GOVERNANCE_POINTER_SECTION_ID, body: renderGovernancePointerBody() },
    { id: SPEC_DISCOVERY_POINTER_SECTION_ID, body: renderSpecDiscoveryPointerBody() },
  ];
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Appends exactly one trailing `"\n"` when `content` doesn't already end with one — idempotent (never doubles up). */
function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

// ─── runContextInit ──────────────────────────────────────────────────────────

/**
 * Writes a fresh (or `--force`-repeated) root `CLAUDE.md`: the lore-managed
 * (Z1) zone (module index / command table / governance pointer / spec
 * discovery pointer) plus, on a genuinely fresh file, a Z2 narrative
 * placeholder (`opts.narrative` if resolved, else {@link SKELETON_NARRATIVE}).
 *
 * @param deps - `{ fs }` — the injected filesystem write capability.
 * @param root - Repo-relative directory to collect facts from (typically `""`).
 * @param opts - `{ narrative?, force? }` — see {@link ContextInitOptions}.
 * @returns `ok(report)` on success. `err(VALIDATION_ERROR)` when
 *   `CLAUDE.md` already exists and `opts.force` is not `true`, or when
 *   `collectContextFacts`/`spliceManagedSections` themselves fail loud
 *   (malformed `root`, a structurally broken existing managed zone).
 * @example
 * const result = await runContextInit({ fs: realFs }, "", { narrative: undefined });
 * // result.value.narrative === "skeleton"
 */
export async function runContextInit(
  deps: ContextFlowDeps,
  root: string,
  opts: ContextInitOptions,
): Promise<Result<ContextInitReport, LoreError>> {
  const existing = await deps.fs.readFile(CLAUDE_MD_PATH);

  if (existing !== null && opts.force !== true) {
    return err({
      code: "VALIDATION_ERROR",
      field: "path",
      message:
        `${CLAUDE_MD_PATH} already exists — run \`lore context refresh\` to regenerate its ` +
        "managed sections, or pass --force to re-run init anyway (existing hand-written " +
        "content outside the managed zone is preserved either way).",
      value: CLAUDE_MD_PATH,
    });
  }

  // reason: init MUST emit the same section list refresh does (project scope), including the Z1
  // `fragments` section — otherwise the first refresh appends it and "init then refresh" is not
  // idempotent (AC-CTX-3; root cause of the regression fixed in
  // task-skill-implement-fix-refresh-idempotence-regression-ac-ctx).
  const fragmentDepsResult = resolveFragmentDeps(deps);
  if (!fragmentDepsResult.ok) return fragmentDepsResult;

  const factsResult = await collectContextFacts(deps.fs, root, resolveFlowBudgets(deps));
  if (!factsResult.ok) return factsResult;

  const sections = renderContextSections(factsResult.value);
  if (fragmentDepsResult.value !== null) {
    const fragmentsSection = await buildScopeFragmentsSection(deps.fs, fragmentDepsResult.value, "project");
    if (!fragmentsSection.ok) return fragmentsSection;
    sections.push(fragmentsSection.value);
  }

  const narrative: ContextNarrativeOutcome = existing !== null ? "existing" : opts.narrative !== undefined ? "generated" : "skeleton";
  const baseContent = existing !== null ? existing : (opts.narrative ?? SKELETON_NARRATIVE);

  const spliceResult = spliceManagedSections(baseContent, sections);
  if (!spliceResult.ok) return spliceResult;

  const finalContent = ensureTrailingNewline(spliceResult.value.content);
  await deps.fs.writeFile(CLAUDE_MD_PATH, finalContent);

  return ok({ path: CLAUDE_MD_PATH, narrative, sections: spliceResult.value.perSection });
}

// ─── Fragment pipeline (Z1 `fragments` section) ──────────────────────────────

/** Project-layer fragment directory, relative to the port root (the repo). */
const PROJECT_FRAGMENTS_DIR = ".lore/context";

/** User-scope memory file, relative to `deps.home`. */
const USER_CLAUDE_MD_RELATIVE = ".claude/CLAUDE.md";

function joinPortPath(root: string, ...parts: string[]): string {
  return [root.endsWith("/") ? root.slice(0, -1) : root, ...parts].join("/");
}

/** sha256 of file bytes; `null` (absent file) hashes to a sentinel no real content can equal. */
function hashFileBytes(content: string | null): string {
  return content === null ? "absent" : `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/**
 * Narrows `deps` to the complete fragment deps, `null` when NONE were supplied (legacy
 * `{ fs }` callers), or a loud error when only some were (never a silent skip).
 */
function resolveFragmentDeps(deps: ContextFlowDeps): Result<FragmentRefreshDeps | null, LoreError> {
  const { assetsRoot, home, xdgConfigHome, globalConfig, projectConfig } = deps;
  const present = [assetsRoot, home, xdgConfigHome, globalConfig, projectConfig].filter((v) => v !== undefined).length;
  if (present === 0) return ok(null);
  if (assetsRoot === undefined || home === undefined || xdgConfigHome === undefined || globalConfig === undefined || projectConfig === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "deps",
      message:
        "fragment refresh deps are partially supplied — assetsRoot, home, xdgConfigHome, globalConfig and projectConfig " +
        "must all be set together.",
    });
  }
  return ok({ assetsRoot, home, xdgConfigHome, globalConfig, projectConfig });
}

/** discover -> checkOverrides -> select -> render -> `fragments` section for one claude-md outlet. */
async function buildScopeFragmentsSection(
  fs: FsWritePort,
  fragmentDeps: FragmentRefreshDeps,
  scope: ContextRefreshScope,
): Promise<Result<ManagedSection, LoreError>> {
  const outlet: OutletId = scope === "user" ? "claude-md:user" : "claude-md:project";

  const discovered = await discoverFragments(fs, {
    shipped: joinPortPath(fragmentDeps.assetsRoot, "context"),
    user: joinPortPath(fragmentDeps.xdgConfigHome, "lore", "context"),
    project: PROJECT_FRAGMENTS_DIR,
  });
  if (!discovered.ok) return discovered;

  const overrides = checkOverrides(discovered.value, { global: fragmentDeps.globalConfig, project: fragmentDeps.projectConfig });
  if (!overrides.ok) return overrides;

  const config = resolveContextConfig(fragmentDeps.globalConfig, fragmentDeps.projectConfig, outlet);
  let selected;
  try {
    selected = selectFragments(discovered.value, { outlet, config });
  } catch (e) {
    // reason: selectFragments throws on a `when` key with no registered matcher (fail loud by
    // design); the flow converts it to the Result channel instead of letting it escape.
    return err({
      code: "VALIDATION_ERROR",
      field: "fragments",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const rendered = renderOutlet(selected, outlet);
  if (!rendered.ok) return rendered;
  return ok(buildFragmentsSection(rendered.value, scope));
}

// ─── runContextRefresh ───────────────────────────────────────────────────────

/**
 * Regenerates ONLY the lore-managed (Z1) zone of an existing memory file
 * from current facts and fragments — never calls AI, never touches Z2 bytes
 * (module header). Idempotent: re-running with unchanged inputs and no
 * hand-edits reproduces byte-identical content. The write is
 * compare-and-swap (module header, D8).
 *
 * @param deps - `{ fs }` plus optional budgets and `FragmentRefreshDeps`.
 * @param root - Repo-relative directory to collect facts from (typically `""`); unused for scope "user".
 * @param opts - `{ scope? }` — "project" (default) or "user".
 * @returns `ok(report)` on success. `err(VALIDATION_ERROR)` when no
 *   project `CLAUDE.md` exists yet (naming `lore context init`), when scope
 *   "user" lacks fragment deps, when discovery/overrides/facts/splice fail
 *   loud, or when the spliced candidate would breach the root claude-md
 *   ceiling (AC-CTX-8, project scope only — module header). `err(CONFLICT)`
 *   when the file changed between read and write. Every error performs NO write.
 * @example
 * const result = await runContextRefresh({ fs: realFs }, "", { scope: "project" });
 * // result.value.sections // => [{ id: "module-index", state: "unchanged" }, ...]
 */
export async function runContextRefresh(
  deps: ContextFlowDeps,
  root: string,
  opts: ContextRefreshOptions = {},
): Promise<Result<ContextRefreshReport, LoreError>> {
  const scope: ContextRefreshScope = opts.scope ?? "project";

  const fragmentDepsResult = resolveFragmentDeps(deps);
  if (!fragmentDepsResult.ok) return fragmentDepsResult;
  const fragmentDeps = fragmentDepsResult.value;

  if (scope === "user" && fragmentDeps === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "scope",
      message: "scope user needs the fragment deps (assetsRoot, home, xdgConfigHome, globalConfig, projectConfig).",
      value: scope,
    });
  }

  const targetPath = fragmentDeps !== null && scope === "user" ? joinPortPath(fragmentDeps.home, USER_CLAUDE_MD_RELATIVE) : CLAUDE_MD_PATH;

  const existing = await deps.fs.readFile(targetPath);
  if (existing === null && scope === "project") {
    return err({
      code: "VALIDATION_ERROR",
      field: "path",
      message: `no ${CLAUDE_MD_PATH} found — run \`lore context init\` first.`,
      value: CLAUDE_MD_PATH,
    });
  }
  const readHash = hashFileBytes(existing);

  const budgets = resolveFlowBudgets(deps);
  const sections: ManagedSection[] = [];
  if (scope === "project") {
    const factsResult = await collectContextFacts(deps.fs, root, budgets);
    if (!factsResult.ok) return factsResult;
    sections.push(...renderContextSections(factsResult.value));
  }
  if (fragmentDeps !== null) {
    const fragmentsSection = await buildScopeFragmentsSection(deps.fs, fragmentDeps, scope);
    if (!fragmentsSection.ok) return fragmentsSection;
    sections.push(fragmentsSection.value);
  }

  const spliceResult = spliceManagedSections(existing ?? "", sections);
  if (!spliceResult.ok) return spliceResult;

  const finalContent = ensureTrailingNewline(spliceResult.value.content);

  // AC-CTX-8 pre-write admission — SSOT: the SAME composition entry `lore
  // status --check-claude-md` runs (`runMemoryFileChecks`), never a second
  // inline size check and never a direct call into the underlying capacity
  // lint (module header, AC-COMPOSE-1). Runs on the SPLICED candidate,
  // before any write.
  // Only `.deterministic` gates the write. `.advisory` never refuses; only its
  // `kind: "downgraded"` entries are surfaced (the `downgraded:` field of the
  // `ok(...)` return below), the rest dropped (module header explains why
  // `fileExists`/`docExists` are inert stand-ins here).
  // reason: the budgets govern the PROJECT root memory file only; the user-scope file is the
  // person's own ~/.claude/CLAUDE.md and has no corpus-governed ceiling, so scope "user" skips it.
  let downgraded: AdvisoryFinding[] = [];
  if (scope === "project") {
    const { deterministic: findings, advisory } = runMemoryFileChecks(
      [{ path: CLAUDE_MD_PATH, role: "root", content: finalContent }],
      budgets,
      { fileExists: () => true, docExists: () => true },
    );
    if (findings.length > 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "path",
        message:
          `refusing to write ${CLAUDE_MD_PATH} — the spliced candidate breaches its ceiling: ` +
          findings.map((finding) => `[${finding.kind}] ${finding.message}`).join("; "),
        value: CLAUDE_MD_PATH,
      });
    }
    downgraded = advisory.filter((finding) => finding.kind === "downgraded");
  }

  // D8 compare-and-swap: re-read and compare the hash of the bytes we spliced against.
  const beforeWrite = await deps.fs.readFile(targetPath);
  if (hashFileBytes(beforeWrite) !== readHash) {
    return err({
      code: "CONFLICT",
      path: targetPath,
      message: `refusing to write ${targetPath} — it changed after refresh read it (another writer interleaved); nothing was written.`,
    });
  }

  await deps.fs.writeFile(targetPath, finalContent);

  return ok({ path: targetPath, sections: spliceResult.value.perSection, downgraded });
}
