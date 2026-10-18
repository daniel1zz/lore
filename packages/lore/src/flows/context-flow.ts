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
 *   - runContextRefresh(deps, root, opts?) — Z1 + lore-rules-file regeneration verb;
 *     `opts.scope` = "project" (default, repo CLAUDE.md + `.claude/rules/lore-*.md`) | "user"
 *     (`<home>/.claude/rules/lore-*.md` only)
 *
 * Invariants:
 *   - `runContextRefresh` NEVER calls any AI provider and NEVER touches Z2
 *     bytes outside the managed zone (D2/D5) — it only ever regenerates the
 *     Z1 zone via `spliceManagedSections`, which already guarantees Z2
 *     byte-preservation and `diverged_skip` on a hand-edited section
 *     (`service/context-projection.ts`'s own invariants, reused verbatim,
 *     never re-implemented here).
 *   - Lore rules files (spec-context-fragments D15/D4/D8/D11/D14, AC-CF-6/13/15): when
 *     `FragmentRefreshDeps` are supplied, refresh runs discover -> checkOverrides ->
 *     selectFragments(outlet rules:<scope>) -> `renderRulesFile` per fragment and writes
 *     `<project>/.claude/rules/lore-<id>.md` (scope project) or `<home>/.claude/rules/lore-<id>.md`
 *     (scope user). It NEVER splices a `fragments` section into CLAUDE.md (that code path was
 *     removed: `runContextInit` writes no fragment content at all). Per file: absent -> `created`;
 *     intact (fingerprint hash matches body) and different -> `updated`; identical -> `unchanged`;
 *     hand-edited -> `diverged_skip` (bytes untouched). `lore-*.md` files whose fragment is no longer
 *     selected are deleted (`pruned`) ONLY when ownership is proven (BR-1176): the file's header
 *     parses (`fragment` + `hash` only) and the body hash still matches (intact fingerprint); a hand-edited,
 *     headerless or extra-token header is kept and reported `diverged_skip`. Files without the `lore-` prefix are never read, written or deleted. Only PART of the fragment deps supplied = loud
 *     VALIDATION_ERROR (never a silent skip); NONE supplied = legacy `{ fs }` callers, project
 *     scope, no rules files (scope "user" with none is an error). Scope "user" never touches any
 *     CLAUDE.md. Each rules file must pass the `context.memory_files.rules` budget or the whole
 *     call is refused with zero writes.
 *   - Lore skill folders (spec-rule-store BR-1064/BR-1060, AC-RS-5): in the same pass refresh selects
 *     `skills:<scope>` fragments and writes `<skillsDir>/lore-<id>/SKILL.md` (frontmatter `description` +
 *     fingerprint), where skillsDir = `<project>/.claude/skills` (scope project, also under `rulesOnly`) or
 *     `<home>/.claude/skills` (scope user). Same per-file states as rules files. A `lore-*` dir is
 *     pruned ONLY when its SKILL.md carries an intact fingerprint whose id and name agree with the dir
 *     name (`isLoreSkillFileBytes`, the same predicate `isLoreSkillDir` uses, evaluated on bytes read through
 *     the port so the CAS covers it); a fingerprint-less or hand-edited dir is never touched, because shipped lore skills live in
 *     `lore-*` dirs too. A skill fragment whose dir name equals a skill shipped with lore
 *     (`deps.shippedSkillNames`, else `<assetsRoot>/skills/lore-*` listed through the port) is refused
 *     with VALIDATION_ERROR (exit 4) and zero writes. Pruning removes SKILL.md (the port deletes
 *     files, not directories), so an empty `lore-<id>/` shell may remain; it has no SKILL.md and is inert.
 *   - Compare-and-swap writes (D8, AC-CF-13): refresh hashes the bytes it read for EVERY target
 *     (CLAUDE.md, each rules file and skill file it will write or delete), re-reads ALL of them right before the
 *     first write and proceeds ONLY if every hash is unchanged; otherwise it returns
 *     `err(CONFLICT)` with ZERO writes. Residual window: between that re-read and each
 *     write/delete the `FsWritePort` has no atomic primitive, so the race is narrowed to one
 *     read-to-write gap, not eliminated. Prune needs `FsWritePort.deleteFile`; a port without it
 *     makes a refresh that must prune fail loud (VALIDATION_ERROR), never skip.
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
 *   - Module index (spec-module-index-lists-only-folders-with-a-memory-file-managed, BR-882 modified):
 *     the `module-index` section lists ONLY folders that carry a memory file (link + first Purpose
 *     sentence, or "no Purpose section"), counts the rest in one line, and says so when the walk was
 *     truncated. The managed sections carry the setup template's H2s (`## Module Index`, `## Finding
 *     Live Project State`; the command table adds none, `## Commands` is hand-written) so refresh never loses a required heading.
 *   - Legacy `auto:module-index` / `auto:dynamic-context` blocks are replaced by the managed zone on the
 *     first init/refresh that sees them (`migrateLegacyAutoBlocks`), reported in `migratedLegacyBlocks`.
 *   - `opts.check` (refresh only) computes the same plan and writes nothing: `report.check` names every
 *     file a refresh would change and any ceiling breach; the CLI exits 1 unless both are empty.
 *
 * Side-effect class: IO (exclusively via the injected `FsWritePort`)
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Design Decisions D1/D2/D3/D5.
 */

import { createHash } from "node:crypto";
import { err, ok, resolveContextConfig, resolveMemoryFileBudgets } from "@lore/core";
import type { ContextConfigLayer, Fragment, FsWritePort, LoreError, MemoryFileBudgets, OutletId, Result } from "@lore/core";
import type { AdvisoryFinding } from "../service/claude-md-findings.js";
import { collectContextFacts, type ContextFacts } from "../service/context-facts.js";
import { runMemoryFileChecks } from "../service/claude-md-admission.js";
import { migrateLegacyAutoBlocks, spliceManagedSections, type ManagedSection, type SpliceResult } from "../service/context-projection.js";
import { discoverFragments } from "../service/context-fragments/discover.js";
import { expandFragments } from "../service/context-fragments/expand.js";
import { LORE_CONTEXT_VARIABLES } from "../service/context-variables-registry.js";
import { resolveUserConfigDir } from "../service/context-fragments/user-config-dir.js";
import {
  isLoreRulesFileName,
  parseRulesFile,
  isLoreSkillFileBytes,
  parseSkillFile,
  renderRulesFile,
  renderSkillFile,
  RULES_FILE_PREFIX,
  RULES_FILE_SUFFIX,
  SKILL_DIR_PREFIX,
  SKILL_FILE_NAME,
} from "../service/context-fragments/section.js";
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
  /** Home directory; the user-scope target dir is `<home>/.claude/rules`. */
  home: string;
  /** User-layer fragments live at `<userConfigDir>/context/*.md`; `userConfigDir` defaults to the XDG resolution of this value. */
  xdgConfigHome: string;
  /**
   * The user's lore config folder when the caller already resolved it (`resolveUserConfigDir`, BR-1065 —
   * the CLI adapters always do, so `LORE_CONFIG_HOME` is honoured). Absent -> resolved here from
   * `xdgConfigHome` alone (the `XDG_CONFIG_HOME/lore` rule), for in-process callers that pass no env.
   */
  userConfigDir?: string;
  /** Raw global (XDG) config layer. */
  globalConfig: ContextConfigLayer;
  /** Raw project (`.lore/config.yaml`) config layer. */
  projectConfig: ContextConfigLayer;
  /**
   * Skill directory names shipped with lore (`lore-<name>`), which a skill fragment must never
   * shadow. Absent -> listed from `<assetsRoot>/skills` through the port.
   */
  shippedSkillNames?: readonly string[];
}

/** Which memory file a refresh targets. */
export type ContextRefreshScope = "project" | "user";

/** Options accepted by {@link runContextRefresh}. */
export interface ContextRefreshOptions {
  /** Defaults to "project". */
  scope?: ContextRefreshScope;
  /**
   * When `true` (project scope), write/prune ONLY the lore rules files and never read, splice or
   * write CLAUDE.md — used by `lore setup --project`, which must not re-splice the scaffolded
   * template. Needs the fragment deps (else VALIDATION_ERROR).
   */
  rulesOnly?: boolean;
  /**
   * When `true`, compute everything a refresh would do and write NOTHING: the report's `check` lists the
   * differing files and any ceiling breach (the caller maps a non-empty result to exit 1). A missing
   * CLAUDE.md is reported as differing rather than refused. Skips the compare-and-swap step (nothing to swap).
   */
  check?: boolean;
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
  /** Legacy auto-block markers (`auto:module-index`, ...) replaced by the managed zone in this call; empty when none. */
  migratedLegacyBlocks: string[];
}

/** What refresh did with one lore rules file (D15). */
export type RulesFileState =
  | "created"
  | "updated"
  | "unchanged"
  | "diverged_skip"
  | "pruned";

/** Per-file outcome of the rules-file pass of one {@link runContextRefresh} call. */
export interface RulesFileOutcome {
  /** Fragment id (the file-name stem after `lore-`). */
  id: string;
  /** Port path of the rules file. */
  path: string;
  state: RulesFileState;
}

/** Per-skill-folder outcome; `path` is the `SKILL.md` port path. Same states as rules files. */
export type SkillDirOutcome = RulesFileOutcome;

/** One finding `lore context refresh --check` reports: the finding's own kind plus its message. */
export interface ContextRefreshCheckFinding {
  kind: string;
  message: string;
}

/** What `lore context refresh --check` found (spec-module-index-lists-only-folders-with-a-memory-file-managed, AC-MI-3). */
export interface ContextRefreshCheck {
  /** Port paths whose bytes differ from their refreshed content (or that a refresh would create/prune), in plan order. */
  differing: string[];
  /**
   * Every deterministic finding on the refreshed root CLAUDE.md, each under its OWN kind (`max_lines` / `max_bytes`
   * ceiling breaches, `section_missing` / `section_duplicate` structure findings, ...). Empty when none. A caller
   * must label each entry by `kind`, never call a structure finding a ceiling breach (MI-T3).
   */
  findings: ContextRefreshCheckFinding[];
}

/** Outcome of one {@link runContextRefresh} call. */
export interface ContextRefreshReport {
  /** Path written: {@link CLAUDE_MD_PATH} (project scope) or the user rules dir `<home>/.claude/rules` (user scope). */
  path: string;
  /** Z1 managed-section outcomes; empty for scope "user" (it writes no CLAUDE.md). */
  sections: SpliceResult["perSection"];
  /** Legacy auto-block markers (`auto:module-index`, ...) replaced by the managed zone in this call; empty when none (migration happens once). */
  migratedLegacyBlocks: string[];
  /** Present only for `opts.check`: what a real refresh would change (nothing was written); `null` otherwise. */
  check: ContextRefreshCheck | null;
  /** One entry per lore rules file considered (selected or pruned); empty without fragment deps. */
  rules: RulesFileOutcome[];
  /** One entry per lore skill folder considered (selected or pruned); empty without fragment deps. */
  skills: SkillDirOutcome[];
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

/** Plural-aware count line for folders that have no memory file; `null` when there are none. */
function renderWithoutMemoryFileLine(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? "1 folder has no memory file and is not listed."
    : `${String(count)} folders have no memory file and are not listed.`;
}

/**
 * Renders the module-index section body from {@link ContextFacts.memoryModules}: the `## Module Index`
 * heading (the same H2 the setup template's managed block carries), one link line per folder that HAS a
 * memory file (first sentence of its Purpose, or "no Purpose section"), one count line for the folders
 * that do not, and a notice when the walk was truncated — never a silent drop (BR-882 modified).
 */
function renderModuleIndexBody(facts: ContextFacts): string {
  const lines: string[] = ["## Module Index", ""];
  if (facts.memoryModules.length === 0) {
    lines.push("No folder has its own memory file yet.");
  } else {
    lines.push("Folders with their own memory file — read it before working there:", "");
    for (const module of facts.memoryModules) {
      lines.push(`- [\`${module.path}\`](${module.memoryFilePath}) — ${module.purpose ?? "no Purpose section"}`);
    }
  }
  const withoutLine = renderWithoutMemoryFileLine(facts.modulesWithoutMemoryFile);
  if (withoutLine !== null) lines.push("", withoutLine);
  if (facts.walkTruncated) {
    lines.push("", `Folder discovery stopped after ${String(facts.moduleIndex.length)} folders; deeper folders are neither listed nor counted.`);
  }
  return lines.join("\n");
}

/**
 * Renders the command-table section body from {@link ContextFacts.commands} — the scripts the project marks
 * as documented (`package.json` `lore.documentedScripts`), NOT every script. With none marked it is a pointer.
 * Decision record: task-skill-design-mi-t4-the-generated-command-table-in-claude (opt-in table; the
 * `check:memory-files` script runs `lore context refresh --check` in the code floor so a package.json edit that
 * changes this section cannot land stale). Z1 contract ("command table (package.json scripts)") is unchanged.
 */
function renderCommandTableBody(facts: ContextFacts): string {
  const entries = Object.entries(facts.commands);
  if (entries.length === 0) {
    return "No scripts are marked as documented (package.json `lore.documentedScripts`); see package.json `scripts` and the Commands section above.";
  }
  // reason: no `## Commands` heading here — the setup template's hand-written part already carries that
  // required section and a second one fails the section check (`section_duplicate`).
  const lines = entries.map(([name, command]) => `- \`${name}\`: \`${command}\``);
  return ["Documented commands (package.json `lore.documentedScripts`):", ...lines].join("\n");
}

/** Renders the governance-pointer section body — static pointer text, no facts needed. */
function renderGovernancePointerBody(): string {
  return (
    "## Finding Live Project State\n\n" +
    "Run `lore governance claude-md` for this project's memory-file content contract. The standing " +
    "corpus-workflow discipline lives in the lore-owned `.claude/rules/lore-*.md` files (written by " +
    "`lore context refresh`; inspect them with `lore fragments`)."
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

  // reason: init writes NO fragment content (D15): static fragments live in lore rules files owned by
  // `runContextRefresh`, and CLAUDE.md never carries a fragments section, so init and refresh agree
  // on CLAUDE.md bytes by construction (AC-CTX-3).
  const factsResult = await collectContextFacts(deps.fs, root, resolveFlowBudgets(deps));
  if (!factsResult.ok) return factsResult;

  const sections = renderContextSections(factsResult.value);

  const narrative: ContextNarrativeOutcome = existing !== null ? "existing" : opts.narrative !== undefined ? "generated" : "skeleton";
  const baseContent = existing !== null ? existing : (opts.narrative ?? SKELETON_NARRATIVE);

  const migration = migrateLegacyAutoBlocks(baseContent);
  const spliceResult = spliceManagedSections(migration.content, sections);
  if (!spliceResult.ok) return spliceResult;

  const finalContent = ensureTrailingNewline(spliceResult.value.content);
  const written = await deps.fs.writeFile(CLAUDE_MD_PATH, finalContent);
  if (!written.ok) return written;

  return ok({ path: CLAUDE_MD_PATH, narrative, sections: spliceResult.value.perSection, migratedLegacyBlocks: migration.migrated });
}

// ─── Fragment pipeline (lore rules files, D15) ───────────────────────────────

/** Project-layer fragment directory, relative to the port root (the repo). */
const PROJECT_FRAGMENTS_DIR = ".lore/context";

/** Project rules directory, relative to the port root (the repo). */
const PROJECT_RULES_DIR = ".claude/rules";

/** User rules directory, relative to `deps.home`. */
const USER_RULES_RELATIVE = ".claude/rules";

/** Project skills directory, relative to the port root (the repo). */
const PROJECT_SKILLS_DIR = ".claude/skills";

/** User skills directory, relative to `deps.home`. */
const USER_SKILLS_RELATIVE = ".claude/skills";

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
  return ok({
    assetsRoot,
    home,
    xdgConfigHome,
    globalConfig,
    projectConfig,
    ...(deps.userConfigDir === undefined ? {} : { userConfigDir: deps.userConfigDir }),
    ...(deps.shippedSkillNames === undefined ? {} : { shippedSkillNames: deps.shippedSkillNames }),
  });
}

/** Fragments selected for the two file outlets of one scope. */
interface ScopeSelection {
  rules: Fragment[];
  skills: Fragment[];
}

/** The three fragment folders one refresh reads; the SSOT for both discovery and the recorded source identity (BR-1176). */
function fragmentRoots(fragmentDeps: FragmentRefreshDeps): { shipped: string; user: string; project: string } {
  return {
    shipped: joinPortPath(fragmentDeps.assetsRoot, "context"),
    user: joinPortPath(
      fragmentDeps.userConfigDir ?? resolveUserConfigDir({ XDG_CONFIG_HOME: fragmentDeps.xdgConfigHome }, fragmentDeps.home),
      "context",
    ),
    project: PROJECT_FRAGMENTS_DIR,
  };
}

/** discover -> checkOverrides -> select for the scope's rules outlet and skills outlet. */
async function selectScopeFragments(
  fs: FsWritePort,
  fragmentDeps: FragmentRefreshDeps,
  scope: ContextRefreshScope,
): Promise<Result<ScopeSelection, LoreError>> {
  const outlets: Record<keyof ScopeSelection, OutletId> =
    scope === "user" ? { rules: "rules:user", skills: "skills:user" } : { rules: "rules:project", skills: "skills:project" };

  const discovered = await discoverFragments(fs, fragmentRoots(fragmentDeps));
  if (!discovered.ok) return discovered;

  const overrides = checkOverrides(discovered.value, { global: fragmentDeps.globalConfig, project: fragmentDeps.projectConfig });
  if (!overrides.ok) return overrides;

  try {
    const selectFor = (outlet: OutletId): Result<Fragment[], LoreError> => {
      const selected = selectFragments(discovered.value, {
        outlet,
        config: resolveContextConfig(fragmentDeps.globalConfig, fragmentDeps.projectConfig, outlet),
      });
      // reason: expansion happens BEFORE any render/fingerprint/budget check, through the one shared helper.
      const expanded = expandFragments(selected, outlet, { invocation: {} }, LORE_CONTEXT_VARIABLES);
      return expanded.ok ? ok([...expanded.value]) : expanded;
    };
    const rules = selectFor(outlets.rules);
    if (!rules.ok) return rules;
    const skills = selectFor(outlets.skills);
    if (!skills.ok) return skills;
    return ok({ rules: rules.value, skills: skills.value });
  } catch (e) {
    // reason: selectFragments throws on a `when` key with no registered matcher (fail loud by
    // design); the flow converts it to the Result channel instead of letting it escape.
    return err({
      code: "VALIDATION_ERROR",
      field: "fragments",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** One planned action on a rules file; `write`/`delete` carry the bytes the CAS hash was taken over. */
type RulesAction =
  | { kind: "write"; outcome: RulesFileOutcome; content: string; readBytes: string | null }
  | { kind: "delete"; outcome: RulesFileOutcome; readBytes: string | null; removeDirIfEmpty?: string }
  | { kind: "none"; outcome: RulesFileOutcome };

/**
 * Plans (reads only, no writes) what refresh does to every lore rules file of one scope:
 * create / update / unchanged / diverged_skip for each selected fragment, delete for every
 * `lore-*.md` whose fragment is no longer selected. Also applies the per-file `rules` budget.
 */
async function planRulesFiles(
  deps: ContextFlowDeps,
  rulesDir: string,
  selected: readonly Fragment[],
  budgets: MemoryFileBudgets,
): Promise<Result<RulesAction[], LoreError>> {
  const actions: RulesAction[] = [];
  const keep = new Set<string>();

  for (const fragment of selected) {
    const rendered = renderRulesFile(fragment);
    if (!rendered.ok) return rendered;
    const { id, fileName, content } = rendered.value;
    keep.add(fileName);
    const path = joinPortPath(rulesDir, fileName);

    const { deterministic: findings } = runMemoryFileChecks([{ path, role: "rules", content }], budgets, {
      fileExists: () => true,
      docExists: () => true,
    });
    if (findings.length > 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "path",
        message:
          `refusing to write ${path} — fragment "${id}" (${fragment.path}) breaches the rules-file budget: ` +
          findings.map((finding) => `[${finding.kind}] ${finding.message}`).join("; "),
        value: path,
      });
    }

    const existing = await deps.fs.readFile(path);
    if (existing === null) {
      actions.push({ kind: "write", outcome: { id, path, state: "created" }, content, readBytes: null });
      continue;
    }
    // reason: BR-1176 — ownership is the intact fingerprint (header parses, body hash matches), not the file name.
    const parsed = parseRulesFile(existing);
    if (parsed === null || !parsed.intact || parsed.id !== id) {
      actions.push({ kind: "none", outcome: { id, path, state: "diverged_skip" } });
    } else if (existing === content) {
      actions.push({ kind: "none", outcome: { id, path, state: "unchanged" } });
    } else {
      actions.push({ kind: "write", outcome: { id, path, state: "updated" }, content, readBytes: existing });
    }
  }

  // reason: prune deletes ONLY a `lore-*.md` whose fingerprint is intact and names this file's own id; every other
  // file in the rules dir is kept and reported diverged_skip, so a hand edit can never be lost (BR-1176).
  const stale = (await deps.fs.listDir(rulesDir)).filter((name) => isLoreRulesFileName(name) && !keep.has(name)).sort();
  for (const name of stale) {
    const path = joinPortPath(rulesDir, name);
    const id = name.slice(RULES_FILE_PREFIX.length, name.length - RULES_FILE_SUFFIX.length);
    const bytes = await deps.fs.readFile(path);
    if (bytes === null) continue;
    const parsed = parseRulesFile(bytes);
    if (parsed === null || !parsed.intact || parsed.id !== id) {
      actions.push({ kind: "none", outcome: { id, path, state: "diverged_skip" } });
      continue;
    }
    if (deps.fs.deleteFile === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "deps.fs",
        message: `cannot prune stale ${path}: the injected FsWritePort has no deleteFile.`,
        value: path,
      });
    }
    actions.push({ kind: "delete", outcome: { id, path, state: "pruned" }, readBytes: bytes });
  }
  return ok(actions);
}

/** Names of the skill directories shipped with lore: the injected list, else `<assetsRoot>/skills/lore-*`. */
async function resolveShippedSkillNames(fs: FsWritePort, fragmentDeps: FragmentRefreshDeps): Promise<ReadonlySet<string>> {
  if (fragmentDeps.shippedSkillNames !== undefined) return new Set(fragmentDeps.shippedSkillNames);
  const names = await fs.listDir(joinPortPath(fragmentDeps.assetsRoot, "skills"));
  return new Set(names.filter((name) => name.startsWith(SKILL_DIR_PREFIX)));
}

/**
 * Plans (reads only) what refresh does to every lore skill folder of one scope: create / update /
 * unchanged / diverged_skip per selected fragment, delete SKILL.md of every fingerprinted `lore-*`
 * dir whose fragment is gone. Refuses (zero actions) a fragment that would shadow a shipped skill.
 */
async function planSkillDirs(
  deps: ContextFlowDeps,
  skillsDir: string,
  selected: readonly Fragment[],
  shipped: ReadonlySet<string>,
): Promise<Result<RulesAction[], LoreError>> {
  const actions: RulesAction[] = [];
  const keep = new Set<string>();

  for (const fragment of selected) {
    const rendered = renderSkillFile(fragment);
    if (!rendered.ok) return rendered;
    const { id, dirName, content } = rendered.value;
    if (shipped.has(dirName)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "fragment.id",
        message:
          `refusing to write skill ${skillsDir}/${dirName} — fragment "${id}" (${fragment.path}) would shadow the skill ` +
          `"${dirName}" shipped with lore; rename the fragment id. Nothing was written.`,
        value: id,
      });
    }
    keep.add(dirName);
    const path = joinPortPath(skillsDir, dirName, SKILL_FILE_NAME);
    const existing = await deps.fs.readFile(path);
    if (existing === null) {
      actions.push({ kind: "write", outcome: { id, path, state: "created" }, content, readBytes: null });
      continue;
    }
    const parsed = parseSkillFile(existing);
    if (parsed === null || !parsed.intact || parsed.id !== id || parsed.name !== dirName) {
      actions.push({ kind: "none", outcome: { id, path, state: "diverged_skip" } });
    } else if (existing === content) {
      actions.push({ kind: "none", outcome: { id, path, state: "unchanged" } });
    } else {
      actions.push({ kind: "write", outcome: { id, path, state: "updated" }, content, readBytes: existing });
    }
  }

  // reason: prune by FINGERPRINT, never by the `lore-` prefix alone — shipped lore skills and any
  // hand-made `lore-*` dir share the prefix and carry no intact fingerprint (BR-1064, BR-1060).
  const candidates = (await deps.fs.listDir(skillsDir)).filter((name) => name.startsWith(SKILL_DIR_PREFIX) && !keep.has(name)).sort();
  for (const name of candidates) {
    const path = joinPortPath(skillsDir, name, SKILL_FILE_NAME);
    const bytes = await deps.fs.readFile(path);
    if (bytes === null) continue;
    if (!isLoreSkillFileBytes(name, bytes)) continue;
    if (deps.fs.deleteFile === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "deps.fs",
        message: `cannot prune stale ${path}: the injected FsWritePort has no deleteFile.`,
        value: path,
      });
    }
    actions.push({
      kind: "delete",
      outcome: { id: name.slice(SKILL_DIR_PREFIX.length), path, state: "pruned" },
      readBytes: bytes,
      removeDirIfEmpty: joinPortPath(skillsDir, name),
    });
  }
  return ok(actions);
}

// ─── runContextRefresh ───────────────────────────────────────────────────────

/**
 * Regenerates the lore-managed (Z1) zone of the project memory file and the lore-owned rules
 * files from current facts and fragments — never calls AI, never touches Z2 bytes or any
 * non-`lore-` rules file (module header). Idempotent: re-running with unchanged inputs and no
 * hand-edits reproduces byte-identical files. Every write is compare-and-swap (module header, D8).
 *
 * @param deps - `{ fs }` plus optional budgets and `FragmentRefreshDeps`.
 * @param root - Repo-relative directory to collect facts from (typically `""`); unused for scope "user".
 * @param opts - `{ scope? }` — "project" (default) or "user".
 * @returns `ok(report)` on success. `err(VALIDATION_ERROR)` when no
 *   project `CLAUDE.md` exists yet (naming `lore context init`), when scope
 *   "user" lacks fragment deps, when discovery/overrides/facts/splice fail
 *   loud, when a rules file breaches its budget, or when the spliced candidate
 *   would breach the root claude-md ceiling (AC-CTX-8, project scope only). ⛔ That ceiling
 *   refusal is the ONE error that does NOT suppress the rules writes (D16, AC-CF-22): CLAUDE.md
 *   stays unchanged, the lore rules files are written, and the error message names the CLAUDE.md
 *   refusal and lists the rules files written (see the `claudeMdRefusalMessage` branch below).
 *   `err(CONFLICT)` when any target changed between read and write. Every other error performs NO
 *   write; a CAS conflict on any rules file suppresses ALL rules writes.
 * @example
 * const result = await runContextRefresh({ fs: realFs }, "", { scope: "project" });
 * // result.value.sections // => [{ id: "module-index", state: "unchanged" }, ...]
 * // result.value.rules    // => [{ id: "corpus-workflow-feed", path: ".claude/rules/lore-corpus-workflow-feed.md", state: "unchanged" }, ...]
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

  const rulesOnly = opts.rulesOnly === true;
  if (rulesOnly && fragmentDeps === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "rulesOnly",
      message: "rulesOnly needs the fragment deps (assetsRoot, home, xdgConfigHome, globalConfig, projectConfig).",
      value: true,
    });
  }
  if (scope === "user" && fragmentDeps === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "scope",
      message: "scope user needs the fragment deps (assetsRoot, home, xdgConfigHome, globalConfig, projectConfig).",
      value: scope,
    });
  }

  const budgets = resolveFlowBudgets(deps);

  // ── Z1 candidate (project scope only; user scope never touches a CLAUDE.md) ──
  let claudeMdWrite: { content: string; readBytes: string } | null = null;
  let sectionOutcomes: SpliceResult["perSection"] = [];
  let downgraded: AdvisoryFinding[] = [];
  let claudeMdRefusalMessage: string | null = null;
  let checkFindings: ContextRefreshCheckFinding[] = [];
  let migratedLegacyBlocks: string[] = [];
  const checkMode = opts.check === true;
  const differing: string[] = [];
  if (scope === "project" && !rulesOnly) {
    const existing = await deps.fs.readFile(CLAUDE_MD_PATH);
    if (existing === null && checkMode) {
      // reason: --check must answer "is the repo refreshed?" — an absent CLAUDE.md is a clear no, not a usage error.
      differing.push(CLAUDE_MD_PATH);
    } else if (existing === null) {
      return err({
        code: "VALIDATION_ERROR",
        field: "path",
        message: `no ${CLAUDE_MD_PATH} found — run \`lore context init\` first.`,
        value: CLAUDE_MD_PATH,
      });
    }
    if (existing !== null) {
      const migration = migrateLegacyAutoBlocks(existing);
      migratedLegacyBlocks = migration.migrated;
      const factsResult = await collectContextFacts(deps.fs, root, budgets);
      if (!factsResult.ok) return factsResult;

      const spliceResult = spliceManagedSections(migration.content, renderContextSections(factsResult.value));
      if (!spliceResult.ok) return spliceResult;
      const finalContent = ensureTrailingNewline(spliceResult.value.content);
      sectionOutcomes = spliceResult.value.perSection;

      // AC-CTX-8 pre-write admission — SSOT: the SAME composition entry `lore
      // status --check-claude-md` runs (`runMemoryFileChecks`), never a second
      // inline size check and never a direct call into the underlying capacity
      // lint (module header, AC-COMPOSE-1). Runs on the SPLICED candidate,
      // before any write. Only `.deterministic` gates the write. `.advisory` never
      // refuses; only its `kind: "downgraded"` entries are surfaced (the
      // `downgraded:` field of the `ok(...)` return below), the rest dropped
      // (module header explains why `fileExists`/`docExists` are inert stand-ins here).
      const { deterministic: findings, advisory } = runMemoryFileChecks(
        [{ path: CLAUDE_MD_PATH, role: "root", content: finalContent }],
        budgets,
        { fileExists: () => true, docExists: () => true },
      );
      if (findings.length > 0) {
        // reason: D16 — the CLAUDE.md refusal must NOT short-circuit the rules-file write set (it is
        // independent of the Z1 splice); it is held here and returned AFTER the rules files are written.
        checkFindings = findings.map((finding) => ({ kind: finding.kind, message: finding.message }));
        claudeMdRefusalMessage =
          `refusing to write ${CLAUDE_MD_PATH} — the spliced candidate breaches its ceiling: ` +
          findings.map((finding) => `[${finding.kind}] ${finding.message}`).join("; ");
      } else {
        downgraded = advisory.filter((finding) => finding.kind === "downgraded");
        claudeMdWrite = { content: finalContent, readBytes: existing };
        // reason: adoption=warn downgrades EVERY deterministic finding to advisory, ceiling breaches included; --check
        // answers "is the root file within its ceiling?", so it re-reads those downgraded ceiling breaches (never the
        // section findings, which stay advisory under warn) instead of reporting a false pass.
        const downgradedCeilings = downgraded.filter(
          (finding) => finding.downgraded_kind === "max_lines" || finding.downgraded_kind === "max_bytes",
        );
        if (checkMode && downgradedCeilings.length > 0) {
          checkFindings = downgradedCeilings.map((finding) => ({
            kind: finding.downgraded_kind ?? "ceiling",
            message: finding.message,
          }));
          claudeMdRefusalMessage = downgradedCeilings.map((finding) => finding.message).join("; ");
        }
      }
      if (finalContent !== existing) differing.push(CLAUDE_MD_PATH);
  
    }
  }

  // ── lore rules files plan ──
  const rulesDir =
    fragmentDeps === null ? null : scope === "user" ? joinPortPath(fragmentDeps.home, USER_RULES_RELATIVE) : PROJECT_RULES_DIR;
  let ruleActions: RulesAction[] = [];
  let skillActions: RulesAction[] = [];
  if (fragmentDeps !== null && rulesDir !== null) {
    const selected = await selectScopeFragments(deps.fs, fragmentDeps, scope);
    if (!selected.ok) return selected;
    const planned = await planRulesFiles(deps, rulesDir, selected.value.rules, budgets);
    if (!planned.ok) return planned;
    ruleActions = planned.value;

    const skillsDir = scope === "user" ? joinPortPath(fragmentDeps.home, USER_SKILLS_RELATIVE) : PROJECT_SKILLS_DIR;
    const shipped = await resolveShippedSkillNames(deps.fs, fragmentDeps);
    const plannedSkills = await planSkillDirs(deps, skillsDir, selected.value.skills, shipped);
    if (!plannedSkills.ok) return plannedSkills;
    skillActions = plannedSkills.value;
  }
  const actions: RulesAction[] = [...ruleActions, ...skillActions];

  // ── --check: report what a refresh would change; no CAS, no write ──
  if (checkMode) {
    for (const action of actions) {
      if (action.kind !== "none") differing.push(action.outcome.path);
    }
    return ok({
      path: (scope === "user" || rulesOnly) && rulesDir !== null ? rulesDir : CLAUDE_MD_PATH,
      sections: sectionOutcomes,
      migratedLegacyBlocks,
      check: { differing, findings: checkFindings },
      rules: ruleActions.map((action) => action.outcome),
      skills: skillActions.map((action) => action.outcome),
      downgraded,
    });
  }

  // ── D8 compare-and-swap: re-read EVERY target before the FIRST write; any change = zero writes ──
  const casTargets: Array<{ path: string; readBytes: string | null }> = [];
  if (claudeMdWrite !== null) casTargets.push({ path: CLAUDE_MD_PATH, readBytes: claudeMdWrite.readBytes });
  for (const action of actions) {
    if (action.kind !== "none") casTargets.push({ path: action.outcome.path, readBytes: action.readBytes });
  }
  for (const target of casTargets) {
    const beforeWrite = await deps.fs.readFile(target.path);
    if (hashFileBytes(beforeWrite) !== hashFileBytes(target.readBytes)) {
      return err({
        code: "CONFLICT",
        path: target.path,
        message: `refusing to write ${target.path} — it changed after refresh read it (another writer interleaved); nothing was written.`,
      });
    }
  }

  if (claudeMdWrite !== null) {
    const written = await deps.fs.writeFile(CLAUDE_MD_PATH, claudeMdWrite.content);
    if (!written.ok) return written;
  }
  const rulesWritten: string[] = []; // rules AND skill files: D16 lists every lore file written
  for (const action of actions) {
    if (action.kind === "write") {
      const written = await deps.fs.writeFile(action.outcome.path, action.content);
      if (!written.ok) return written;
      rulesWritten.push(action.outcome.path);
    } else if (action.kind === "delete") {
      const deleted = await deps.fs.deleteFile?.(action.outcome.path);
      if (deleted !== undefined && !deleted.ok) return deleted;
      // reason: a pruned skill leaves an empty `lore-<id>/` dir; remove it only when empty so a
      // hand-added file beside SKILL.md keeps its folder (BR-1064, BR-1060).
      if (action.removeDirIfEmpty !== undefined) {
        const removed = await deps.fs.removeDirIfEmpty?.(action.removeDirIfEmpty);
        if (removed !== undefined && !removed.ok) return removed;
      }
    }
  }

  if (claudeMdRefusalMessage !== null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "path",
      message:
        `${claudeMdRefusalMessage} — CLAUDE.md left unchanged; lore rules files written independently (D16): ` +
        (rulesWritten.length > 0 ? rulesWritten.join(", ") : "none changed"),
      value: CLAUDE_MD_PATH,
    });
  }

  return ok({
    path: (scope === "user" || rulesOnly) && rulesDir !== null ? rulesDir : CLAUDE_MD_PATH,
    sections: sectionOutcomes,
    migratedLegacyBlocks,
    check: null,
    rules: ruleActions.map((action) => action.outcome),
    skills: skillActions.map((action) => action.outcome),
    downgraded,
  });
}
