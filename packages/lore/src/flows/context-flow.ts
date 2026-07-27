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
 *   - ContextFlowDeps — `{ fs: FsWritePort }`, the ONLY injected dependency
 *   - runContextInit(deps, root, opts) — first-write / re-init verb
 *   - runContextRefresh(deps, root) — Z1-only regeneration verb
 *
 * Invariants:
 *   - `runContextRefresh` NEVER calls any AI provider and NEVER touches Z2
 *     bytes outside the managed zone (D2/D5) — it only ever regenerates the
 *     Z1 zone via `spliceManagedSections`, which already guarantees Z2
 *     byte-preservation and `diverged_skip` on a hand-edited section
 *     (`service/context-projection.ts`'s own invariants, reused verbatim,
 *     never re-implemented here).
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
 *   - Both verbs use `resolveMemoryFileBudgets(undefined)` (schema
 *     defaults) for `collectContextFacts`'s budgets — `ContextFlowDeps`
 *     deliberately carries no `LoreConfig`/store dependency (D9: "keeps this
 *     module vitest-testable with plain fakes"); the ONLY config value
 *     `collectContextFacts` reads is `.filenames` (default `["CLAUDE.md"]`),
 *     which is not a realistic per-project override target.
 *   - `runContextRefresh` pre-write admission (AC-CTX-8, root cause:
 *     knowledge-retro-context-refresh-module-index-walk-pollutes): AFTER
 *     splicing and appending the trailing newline but BEFORE calling
 *     `deps.fs.writeFile`, the spliced candidate is run through
 *     `claude-md-check.ts`'s `lintMemoryFiles` — the SAME ceiling-check
 *     implementation `lore status --check-claude-md` consumes (SSOT: never a
 *     second inline size check here) — against `resolveMemoryFileBudgets(undefined)`,
 *     the same defaults `collectContextFacts` already reads. Any finding
 *     (root role, `max_lines` or `max_bytes`) refuses the whole call with
 *     `err(VALIDATION_ERROR)` naming every breach and performs NO write — a
 *     within-budget splice is unaffected (byte-identical to pre-check
 *     behavior). `runContextInit` does NOT run this check: its own
 *     already-exists refusal is the narrower, pre-existing guard for that
 *     verb (out of this AC's scope), and `--force` (init-only) never
 *     bypasses `runContextRefresh`'s check either, since refresh has no
 *     `--force` option to bypass with.
 *
 * Side-effect class: IO (exclusively via the injected `FsWritePort`)
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Design Decisions D1/D2/D3/D5.
 */

import { err, ok, resolveMemoryFileBudgets } from "@lore/core";
import type { FsWritePort, LoreError, Result } from "@lore/core";
import { collectContextFacts, type ContextFacts } from "../service/context-facts.js";
import { lintMemoryFiles } from "../service/claude-md-check.js";
import { spliceManagedSections, type ManagedSection, type SpliceResult } from "../service/context-projection.js";

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

/** The `{ fs }` dependency every context-flow verb takes — see module header's "no config/store" invariant. */
export interface ContextFlowDeps {
  fs: FsWritePort;
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
  /** Repo-relative path written — always {@link CLAUDE_MD_PATH}. */
  path: string;
  sections: SpliceResult["perSection"];
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
    "Run `lore governance claude-md` for this project's memory-file content contract, and " +
    "`lore governance` for the standing corpus-workflow discipline."
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

  const factsResult = await collectContextFacts(deps.fs, root, resolveMemoryFileBudgets(undefined));
  if (!factsResult.ok) return factsResult;

  const sections = renderContextSections(factsResult.value);

  const narrative: ContextNarrativeOutcome = existing !== null ? "existing" : opts.narrative !== undefined ? "generated" : "skeleton";
  const baseContent = existing !== null ? existing : (opts.narrative ?? SKELETON_NARRATIVE);

  const spliceResult = spliceManagedSections(baseContent, sections);
  if (!spliceResult.ok) return spliceResult;

  const finalContent = ensureTrailingNewline(spliceResult.value.content);
  await deps.fs.writeFile(CLAUDE_MD_PATH, finalContent);

  return ok({ path: CLAUDE_MD_PATH, narrative, sections: spliceResult.value.perSection });
}

// ─── runContextRefresh ───────────────────────────────────────────────────────

/**
 * Regenerates ONLY the lore-managed (Z1) zone of an existing root
 * `CLAUDE.md` from current facts — never calls AI, never touches Z2 bytes
 * (module header). Idempotent: re-running with unchanged facts and no
 * hand-edits reproduces byte-identical content.
 *
 * @param deps - `{ fs }` — the injected filesystem write capability.
 * @param root - Repo-relative directory to collect facts from (typically `""`).
 * @returns `ok(report)` on success. `err(VALIDATION_ERROR)` when no
 *   `CLAUDE.md` exists yet (naming `lore context init`), when
 *   `collectContextFacts`/`spliceManagedSections` fail loud (malformed
 *   `root`, a structurally broken existing managed zone), or when the
 *   spliced candidate would breach the root claude-md ceiling (AC-CTX-8,
 *   module header) — that last case performs NO write.
 * @example
 * const result = await runContextRefresh({ fs: realFs }, "");
 * // result.value.sections // => [{ id: "module-index", state: "unchanged" }, ...]
 */
export async function runContextRefresh(
  deps: ContextFlowDeps,
  root: string,
): Promise<Result<ContextRefreshReport, LoreError>> {
  const existing = await deps.fs.readFile(CLAUDE_MD_PATH);
  if (existing === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "path",
      message: `no ${CLAUDE_MD_PATH} found — run \`lore context init\` first.`,
      value: CLAUDE_MD_PATH,
    });
  }

  const budgets = resolveMemoryFileBudgets(undefined);
  const factsResult = await collectContextFacts(deps.fs, root, budgets);
  if (!factsResult.ok) return factsResult;

  const sections = renderContextSections(factsResult.value);

  const spliceResult = spliceManagedSections(existing, sections);
  if (!spliceResult.ok) return spliceResult;

  const finalContent = ensureTrailingNewline(spliceResult.value.content);

  // AC-CTX-8 pre-write admission — SSOT: the SAME check `lore status
  // --check-claude-md` runs, never a second inline size check (module
  // header). Runs on the SPLICED candidate, before any write.
  const findings = lintMemoryFiles([{ path: CLAUDE_MD_PATH, role: "root", content: finalContent }], budgets);
  if (findings.length > 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "path",
      message:
        `refusing to write ${CLAUDE_MD_PATH} — the spliced candidate breaches its ceiling: ` +
        findings.map((finding) => finding.message).join("; "),
      value: CLAUDE_MD_PATH,
    });
  }

  await deps.fs.writeFile(CLAUDE_MD_PATH, finalContent);

  return ok({ path: CLAUDE_MD_PATH, sections: spliceResult.value.perSection });
}
