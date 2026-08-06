/**
 * lore status — repository and corpus statistics and health check.
 * With --check-tree: validate corpus against lore.tree.yaml blueprint.
 * With --check-tree --fix: auto-fix orphan/misplaced drift.
 * With --check-drift: verify spec-declared code_anchors against the working tree
 *   (SPEC-045 §Design Decisions D5) — deterministic, zero LLM calls.
 * With --check-issues: flag unclosed issue escalations (computed `fixed` while the
 *   issue task itself is not `archived`) and stale open reports (computed `open` and
 *   older than `feedback.stale_after_days`) — deterministic, report-only, mutates
 *   nothing (spec-issue-closure-loop-computed-resolution-agent-reachable §D5).
 * With --check-claude-md: lint project memory files (CLAUDE.md by default)
 *   against corpus-governed line/byte ceilings (spec-project-claude-md-
 *   content-contract-governance-injected §D9) — see that branch's own inline
 *   comment for why it is dispatched BEFORE every other flag reaches
 *   `loadLoreApp`. ALWAYS additionally reports used/ceiling/remaining
 *   headroom for every measured file (task-lore-status-check-claude-md-
 *   reports-a-saturated-file-as: a bare pass/fail hid a file 5 bytes from
 *   its ceiling as "within budget"), and emits an advisory (never
 *   exit-affecting) warning once a metric crosses
 *   `context.memory_files.warn_threshold_fraction` of its ceiling.
 * With --json: output check result(s) as a JSON envelope.
 *
 * --check-tree and --check-drift COMPOSE (SPEC-045 D5 restructure — neither check
 * early-exits the process anymore; both are value-returning, combined at the end):
 *
 * Exit-code precedence when either flag is passed:
 *   any drift found (either check)                          → 3
 *   else blueprint missing/invalid (--check-tree requested)  → 4
 *   else                                                      → 0
 *
 * Both requested reports always print/emit fully — a real code drift is never
 * masked by a missing lore.tree.yaml, and vice versa. Worked example: drift
 * disabled (workflow.drift.enabled=false) + an inconsistent tree → the drift
 * section prints its explicit "disabled" note, the tree section prints its
 * drifts, exit 3 (tree drift alone already wins).
 *
 * --check-claude-md is a SEPARATE, standalone dispatch — it does NOT compose
 * with --check-tree/--check-drift/--check-requirements/--check-prd-budget/
 * --check-issues in one combined run (spec Module Boundary invariant 2: this
 * check must never reach `loadLoreApp`/`bun:sqlite`, so it cannot share the
 * app-backed branch those five flags fold into). Passing --check-claude-md
 * alongside any of those flags runs ONLY the memory-file check; see that
 * branch for exit codes.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { buildStalenessFlowDeps, listFreshStalenessEscalates } from "../../../flows/staleness-flow.js";
import { loadTreeBlueprint } from "../../../flows/blueprint-flow.js";
import {
  buildDriftFlowDeps,
  buildListSpecs,
  countArmedSpecs,
  disabledCodeDriftPayload,
  renderDriftRepairHint,
  runDrift,
  SYMBOL_MISSING_FOOTNOTE,
  type CodeDriftPayload,
} from "../../../flows/drift-flow.js";
import { buildRealFsProbe } from "../../real-fs-probe.js";
import {
  contextConfigSchema,
  ok,
  resolveDriftEnabled,
  resolveMemoryFileBudgets,
  resolveStaleAfterDays,
  SPEC_KINDS,
  outlineEntrySchema,
  outlineBudgetSchema,
} from "@lore/core";
import type { CallerSurface, LoreConfig, LoreError, MemoryFileBudgets, OutlineBudget, Result } from "@lore/core";
import { z } from "zod";
import {
  checkPrdBudget,
  type OutlineBudgetLike,
  type PrdBudgetBreach,
} from "../../../service/prd-budget-check.js";
import { renderExemptPlansSection } from "../../../flows/status-prd-sync-flow.js";
import {
  computeIssueResolution,
  hasIssueReport,
  type ResolutionSourceDocLike,
  type ResolvesInEdgeLike,
} from "../../../service/issue-resolution.js";
// reason: loadConfig reads `.lore/config.yaml` via plain Node fs — only
// reachable via the `@lore/core/node` subpath (browser-safety split,
// packages/core/src/CLAUDE.md). NOT a bun:sqlite dependency, so it's safe to
// call from the --check-claude-md branch below, which per the spec's Module
// Boundary invariant 2 must NEVER reach loadLoreApp/bun:sqlite — mirrors
// setup-check.ts's identical precedent for this exact import.
import { loadConfig } from "@lore/core/node";
import { discoverMemoryFiles } from "../../real-memory-file-probe.js";
import {
  computeHeadroom,
  computeHeadroomWarnings,
  lintMemoryFiles,
  type HeadroomReport,
  type MemoryFileFinding,
} from "../../../service/claude-md-check.js";

/** All CallerSurface values in a stable display order. */
const ALL_SURFACES: ReadonlyArray<CallerSurface> = [
  "cli",
  "agent",
  "mcp",
  "http_cookie",
  "http_token",
] as const;

/**
 * Compute resolved per-surface AI defaults for the current app config.
 * Temporarily cycles through each surface using resolveAiDefault.
 * The current surface is restored after the loop.
 *
 * @param app - Wired App instance.
 * @returns Record mapping each CallerSurface to its resolved AI boolean.
 */
function computeAiDefaults(app: ReturnType<typeof loadLoreApp>["app"]): Record<string, boolean> {
  const saved = app.callerSurface;
  const result: Record<string, boolean> = {};
  for (const surface of ALL_SURFACES) {
    app.callerSurface = surface;
    result[surface] = app.resolveAiDefault(undefined).ai;
  }
  app.callerSurface = saved;
  return result;
}

/**
 * Computes the SPEC-058 discoverability summary for `workflow.
 * verification_profiles` — a store-only, zero-fs-probing, zero-store-read
 * derivation (unlike `--check-drift`) since the data lives entirely in the
 * already-loaded config object. Mirrors the SPEC-044/045 "print an armed-count
 * one-liner, only when there's something to say" precedent (`open_stale_
 * candidates` / `code_anchor_specs` above): an unconfigured corpus prints
 * nothing extra — discoverability for corpora that HAVE opted in, never noise
 * for ones that haven't.
 *
 * @param config - The resolved LoreConfig, or `undefined` when no
 *   `.lore/config.yaml` was loaded (`resolveVerificationProfile`'s own
 *   "absence means unconfigured" contract).
 * @returns The configured spec_kinds, in {@link SPEC_KINDS} order, or `[]` when
 *   none are configured.
 */
function configuredVerificationProfileKinds(config: LoreConfig | undefined): string[] {
  return SPEC_KINDS.filter((kind) => config?.workflow?.verification_profiles?.[kind] !== undefined);
}

/**
 * Maps `@lore/core`'s `OutlineBudget` (SPEC-080 C3 corpus-governed schema,
 * field names `core_max_chars`/`domain_max_chars`/`whole_body_max_chars`)
 * onto `prd-budget-check.ts`'s own pure-fn input shape (`OutlineBudgetLike`,
 * field names `core_chars`/`domain_chars`/`whole_doc_chars`) — the two
 * modules deliberately do not share field names (see `prd-budget-check.ts`'s
 * module header), so this adapter is the ONE place the mapping happens.
 *
 * @param core - A Zod-validated `prd.extra.outline_budget`, or `undefined`
 *   when the PRD declares none (checkPrdBudget then falls back to the
 *   SPEC-080 C3 stated defaults for every field).
 * @returns The equivalent `Partial<OutlineBudgetLike>`, or `undefined`.
 */
function toOutlineBudgetLike(core: OutlineBudget | undefined): Partial<OutlineBudgetLike> | undefined {
  if (core === undefined) return undefined;
  return {
    core_chars: core.core_max_chars,
    domain_chars: core.domain_max_chars,
    whole_doc_chars: core.whole_body_max_chars,
    extra_prose_chars: core.extra_prose_chars,
  };
}

/** Text rendering for one PRD's budget breaches — used by `renderPrdBudgetSection`. */
function renderPrdBudgetBreach(prdSlug: string, breach: PrdBudgetBreach): void {
  const sectionSuffix = breach.section !== undefined ? ` (${breach.section})` : "";
  console.log(`  - ${prdSlug} [${breach.kind}]${sectionSuffix}: ${breach.detail}`);
}

/**
 * Text rendering for the `--check-prd-budget` section (SPEC-080 C3) — used
 * regardless of whether `--check-tree`/`--check-drift`/`--check-requirements`
 * were ALSO requested (every requested section always prints fully).
 */
function renderPrdBudgetSection(payload: {
  checked: number;
  consistent: boolean;
  prds: Array<{ slug: string; whole_doc_chars: number; breaches: PrdBudgetBreach[] }>;
}): void {
  if (payload.consistent) {
    console.log(`PRD budget: within budget (${payload.checked} PRD(s) checked).`);
    return;
  }
  console.log(`PRD budget: BREACHED (${payload.checked} PRD(s) checked):`);
  for (const prd of payload.prds) {
    for (const breach of prd.breaches) {
      renderPrdBudgetBreach(prd.slug, breach);
    }
  }
}

/**
 * Text rendering for the `--check-drift` section (D5) — used regardless of
 * whether `--check-tree` was ALSO requested (both sections always print fully).
 */
function renderDriftSection(payload: CodeDriftPayload): void {
  if (!payload.enabled) {
    console.log("Code drift: disabled (workflow.drift.enabled=false)");
    return;
  }
  if (!payload.armed) {
    console.log("Code drift: armed=false (no spec declares code_anchors)");
    return;
  }
  if (payload.consistent) {
    console.log(`Code drift: consistent (${payload.specs_checked} spec(s) checked)`);
    return;
  }
  console.log(`Code drift: ${payload.drifts.length} drift(s) (${payload.specs_checked} spec(s) checked)`);
  for (const row of payload.drifts) {
    console.log(`  - ${row.spec_slug} → ${row.anchor} (${row.kind})`);
    console.log(`    ${renderDriftRepairHint(row)}`);
  }
  if (payload.drifts.some((d) => d.kind === "symbol_missing")) {
    console.log(`  ${SYMBOL_MISSING_FOOTNOTE}`);
  }
}

// ── `--check-issues` detector (D5, spec-issue-closure-loop-computed-resolution-agent-reachable) ──

/** One issue task flagged as an "unclosed escalation" (D5a shape (a)). */
interface UnclosedEscalation {
  id: string;
  slug: string;
  title: string;
}

/** One issue task flagged as a "stale open report" (D5a shape (b)). */
interface StaleOpenReport {
  id: string;
  slug: string;
  title: string;
  reported_at: string;
  age_days: number;
}

/** `--check-issues` result payload — mirrors the other check sections' `{checked, consistent, ...}` shape. */
interface IssueCheckPayload {
  checked: number;
  consistent: boolean;
  unclosed_escalations: UnclosedEscalation[];
  stale_open: StaleOpenReport[];
}

/**
 * Defensive `extra.issue_report.reported_at` reader — mirrors
 * `packages/core/src/issue-report.ts::readReporterProject`'s guard shape
 * (duplicated rather than imported: that reader is scoped to a different
 * field for a different caller, and `extra.issue_report` is deliberately
 * untyped passthrough — see that module's own header). A malformed/legacy
 * `extra`, or an `issue_report` missing/mistyped `reported_at`, degrades to
 * `undefined` rather than throwing.
 */
function readReportedAt(extra: unknown): string | undefined {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return undefined;
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) return undefined;
  const reportedAt = (issueReport as Record<string, unknown>)["reported_at"];
  return typeof reportedAt === "string" ? reportedAt : undefined;
}

/**
 * D5 — `lore status --check-issues` detector. REPORT-ONLY: every call below
 * is a read (`corpusService.listFull`/`corpusService.get`) — never a write
 * (AC-ICL-6's byte-comparison oracle proves this at the test layer).
 *
 * Flags two shapes:
 *   (a) unclosed escalation — {@link computeIssueResolution} (P1,
 *       `issue-resolution.ts`, CONSUMED not reimplemented) returns `fixed`
 *       (>=1 `resolves` in-edge whose source doc reached active/archived)
 *       while the issue task's OWN status is not yet `archived` — the "code
 *       shipped, task never closed" shape this whole spec exists to make
 *       loud.
 *   (b) stale open report — computed resolution is `open` (no `resolves`
 *       edge at all) and `extra.issue_report.reported_at` is `staleAfterDays`
 *       days old OR OLDER (INCLUSIVE boundary — mirrors `staleness.ts`'s
 *       documented `age_days === min_age_days` INCLUDED precedent, SPEC-044
 *       D1, so this codebase's two day-threshold detectors agree on what
 *       "older than N days" means at the exact boundary).
 *
 * `resolvesInEdges`/`sourceDocs` are read via `corpusService.get(issueId)`'s
 * `navigation.related` (the only doc-level "which docs link to me, by what
 * type" surface a CLI command may call — adapters/cli carries no business
 * logic, `packages/lore/src/service/CLAUDE.md`) filtered to `link_type ===
 * "resolves"`. This relies on `CorpusService.link`'s write-time D1b
 * validation (`corpus-service.ts`, "a resolves edge's to MUST be a task
 * carrying extra.issue_report"): every `resolves`-typed entry on an issue
 * task's OWN `related` list is therefore structurally an IN-edge (the issue
 * task is always the `to` side in a well-formed corpus) — an issue task
 * ALSO independently being the `from` side of a different resolves edge
 * (double-duty fixing-artifact-that-is-itself-a-report) is a pathological
 * state outside this detector's scope.
 *
 * @param app - Wired application instance (read-only calls only)
 * @param staleAfterDays - Resolved `feedback.stale_after_days` (D5b)
 * @returns `ok(payload)`; `err` only on an underlying store read failure
 */
async function computeIssueCheck(
  app: ReturnType<typeof loadLoreApp>["app"],
  staleAfterDays: number,
): Promise<Result<IssueCheckPayload, LoreError>> {
  const tasksResult = await app.corpusService.listFull({ type: "task" });
  if (!tasksResult.ok) return tasksResult;

  const issueTasks = tasksResult.value.docs.filter((doc) => hasIssueReport(doc.extra));

  const unclosedEscalations: UnclosedEscalation[] = [];
  const staleOpen: StaleOpenReport[] = [];
  const nowMs = Date.now();

  for (const issueTask of issueTasks) {
    const getResult = await app.corpusService.get(issueTask.id);
    if (!getResult.ok) return getResult;

    const resolvesRelated = getResult.value.navigation.related.filter(
      (related) => related.link_type === "resolves",
    );
    const resolvesInEdges: ResolvesInEdgeLike[] = resolvesRelated.map((related) => ({ from_id: related.id }));
    const sourceDocs: ResolutionSourceDocLike[] = resolvesRelated.map((related) => ({
      id: related.id,
      status: related.status,
    }));

    const resolution = computeIssueResolution({ extra: issueTask.extra }, resolvesInEdges, sourceDocs);

    if (resolution === "fixed" && issueTask.status !== "archived") {
      unclosedEscalations.push({ id: issueTask.id, slug: issueTask.slug, title: issueTask.title });
    }

    if (resolution === "open") {
      const reportedAt = readReportedAt(issueTask.extra);
      if (reportedAt !== undefined) {
        const ageDays = Math.floor((nowMs - new Date(reportedAt).getTime()) / 86_400_000);
        if (Number.isFinite(ageDays) && ageDays >= staleAfterDays) {
          staleOpen.push({
            id: issueTask.id,
            slug: issueTask.slug,
            title: issueTask.title,
            reported_at: reportedAt,
            age_days: ageDays,
          });
        }
      }
    }
  }

  return ok({
    checked: issueTasks.length,
    consistent: unclosedEscalations.length === 0 && staleOpen.length === 0,
    unclosed_escalations: unclosedEscalations,
    stale_open: staleOpen,
  });
}

/**
 * Text rendering for the `--check-issues` section (D5) — used regardless of
 * whether other sections were ALSO requested (every requested section always
 * prints fully).
 */
function renderIssuesSection(payload: IssueCheckPayload): void {
  if (payload.consistent) {
    console.log(`Issue closure: consistent (${payload.checked} issue report(s) checked).`);
    return;
  }
  const total = payload.unclosed_escalations.length + payload.stale_open.length;
  console.log(`Issue closure: ${total} issue(s) flagged (${payload.checked} checked):`);
  for (const row of payload.unclosed_escalations) {
    console.log(
      `  - ${row.slug} [unclosed escalation]: computed resolution is fixed but the issue task is not archived ` +
        `(fix: \`lore done ${row.slug}\` or \`lore set ${row.slug} --status archived\` once verified)`,
    );
  }
  for (const row of payload.stale_open) {
    console.log(
      `  - ${row.slug} [stale open]: reported ${row.reported_at}, ${row.age_days}d old, still open ` +
        `(fix: triage via \`lore issue resolve ${row.slug} --state rejected|wontfix --reason <r>\`, or link a fixing doc via \`lore link ... --type resolves ${row.slug}\`)`,
    );
  }
}

/**
 * Text rendering for one `--check-claude-md` finding — always names `path`
 * (the finding's own `message` already does this; the extra prefixed line
 * below additionally surfaces the repair pointer once per run, not per
 * finding, see the caller).
 */
function renderClaudeMdFinding(finding: MemoryFileFinding): void {
  console.log(`  - ${finding.message}`);
}

/**
 * Text rendering for one `--check-claude-md` headroom row — printed on
 * EVERY run (task-lore-status-check-claude-md-reports-a-saturated-file-as:
 * a bare pass/fail hid a file 5 bytes from its ceiling as "within budget",
 * so used/ceiling/remaining now render unconditionally, never only on a
 * breach).
 */
function renderHeadroomLine(report: HeadroomReport): void {
  console.log(
    `  ${report.path} (${report.role}): lines ${report.lines.used}/${report.lines.ceiling} ` +
      `(${report.lines.remaining} remaining), bytes ${report.bytes.used}/${report.bytes.ceiling} ` +
      `(${report.bytes.remaining} remaining)`,
  );
}

/**
 * Resolves the effective `context.memory_files.*` budgets for
 * `--check-claude-md` from `<cwd>/.lore/config.yaml`, tolerating a config
 * file that is invalid EVERYWHERE ELSE (spec-project-claude-md-content-
 * contract-governance-injected Module Boundary invariant 2 — this check must
 * work "config-only", independent of whether the rest of `LoreConfig` has
 * ever been validated, e.g. via `lore init`). `loadConfig` validates the
 * WHOLE `LoreConfig` (requires `project.name`/`project.author`); a caller
 * who has hand-authored a `.lore/config.yaml` containing ONLY a `context:`
 * block (no `lore init` run yet) would otherwise have that section silently
 * ignored. On a `VALIDATION_ERROR` whose `value` still carries the raw
 * parsed YAML object (a schema violation — never a malformed-YAML string or
 * a missing-file `STORE_ERROR`, neither of which carries a usable `value`),
 * this re-validates JUST the `context` sub-tree via `contextConfigSchema`
 * before falling back to the schema defaults.
 *
 * @param cwd - Directory to resolve `.lore/config.yaml` from.
 * @returns The resolved budgets — schema defaults when no config was found
 *   or usable (root 300L/30720B, module 200L/16384B, `enabled: true`).
 */
function resolveClaudeMdBudgets(cwd: string): MemoryFileBudgets {
  const configResult = loadConfig(cwd);
  if (configResult.ok) return resolveMemoryFileBudgets(configResult.value);

  const { error } = configResult;
  if (error.code === "VALIDATION_ERROR" && typeof error.value === "object" && error.value !== null) {
    const contextCandidate = (error.value as Record<string, unknown>)["context"];
    const contextParse = contextConfigSchema.safeParse(contextCandidate);
    if (contextParse.success) return contextParse.data.memory_files;
  }

  return resolveMemoryFileBudgets(undefined);
}

export default defineCommand({
  meta: {
    name: "status",
    description: "Repository and corpus statistics and health check",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    "check-tree": {
      type: "boolean",
      description: "Check tree against lore.tree.yaml blueprint",
    },
    fix: {
      type: "boolean",
      description: "Apply --check-tree fixes for orphan/misplaced drift",
    },
    "check-drift": {
      type: "boolean",
      description:
        "Verify spec-declared code_anchors against the working tree (SPEC-045). Composes with --check-tree.",
    },
    "check-requirements": {
      type: "boolean",
      description:
        "Verify every PRD requirement is covered by a descendant spec AC (SPEC-055). Uncovered P0 → exit 3. Composes with --check-tree/--check-drift.",
    },
    "check-prd-budget": {
      type: "boolean",
      description:
        "Verify every PRD's rendered body/outline-entry/extra-prose char budgets (SPEC-080 C3). Breach → exit 3. Composes with --check-tree/--check-drift/--check-requirements.",
    },
    "check-issues": {
      type: "boolean",
      description:
        "Flag unclosed issue escalations (computed fixed, task not archived) and stale open reports (older than feedback.stale_after_days). Report-only, mutates nothing. Breach → exit 3. Composes with --check-tree/--check-drift/--check-requirements/--check-prd-budget.",
    },
    "check-claude-md": {
      type: "boolean",
      description:
        "Lint project memory files (CLAUDE.md by default) against corpus-governed line/byte ceilings, always reporting used/ceiling/remaining headroom. Config-only, never loads the corpus DB. Breach → exit 3; a near-ceiling advisory warning never changes the exit code.",
    },
  },
  async run({ args }) {
    const checkTreeRequested = args["check-tree"] === true;
    const checkDriftRequested = args["check-drift"] === true;
    const checkRequirementsRequested = args["check-requirements"] === true;
    const checkPrdBudgetRequested = args["check-prd-budget"] === true;
    const checkIssuesRequested = args["check-issues"] === true;
    const checkClaudeMdRequested = args["check-claude-md"] === true;

    // ── check-claude-md branch (spec-project-claude-md-content-contract-governance-injected §D9) ──
    // reason: MUST short-circuit BEFORE loadLoreApp — the spec's Module
    // Boundary invariant 2 requires this check to work with NO `.lore/` at
    // all, and to stay unaffected by a `.lore/` that carries a config file
    // but no SQLite DB. `loadLoreApp` (below, in every other branch) opens
    // `bun:sqlite`, which would violate that invariant outright. This
    // dispatch is therefore hoisted above the app-backed
    // check-tree/check-drift/check-requirements/check-prd-budget/check-issues
    // branch and returns before that branch is ever reached.
    if (checkClaudeMdRequested) {
      const budgets = resolveClaudeMdBudgets(process.cwd());
      const files = discoverMemoryFiles(process.cwd(), budgets.filenames);
      const findings = lintMemoryFiles(files, budgets);
      // Headroom/warnings are a REPORTING layer alongside `lintMemoryFiles` —
      // task-lore-status-check-claude-md-reports-a-saturated-file-as: they
      // never affect `findings` or the exit code below (still `findings.length
      // > 0 ? 3 : 0`, byte-identical breach semantics to before this change).
      const headroom = computeHeadroom(files, budgets);
      const warnings = computeHeadroomWarnings(headroom);

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { claude_md: { findings, headroom, warnings } } }, null, 2));
      } else {
        if (findings.length === 0) {
          console.log("CLAUDE.md: within budget (0 findings).");
        } else {
          console.log(`CLAUDE.md: BREACHED (${findings.length} finding(s)):`);
          for (const finding of findings) renderClaudeMdFinding(finding);
          console.log("  fix: trim the file, or run `lore governance claude-md` for the content contract.");
        }

        for (const report of headroom) renderHeadroomLine(report);

        if (warnings.length > 0) {
          console.log(`CLAUDE.md: approaching ceiling (${warnings.length} advisory warning(s), exit code unaffected):`);
          for (const warning of warnings) console.log(`  - ${warning.message}`);
        }
      }

      process.exitCode = findings.length > 0 ? 3 : 0;
      return;
    }

    // ── check-tree / check-drift / check-requirements / check-prd-budget / check-issues branch (D5 restructure) ────
    if (
      checkTreeRequested ||
      checkDriftRequested ||
      checkRequirementsRequested ||
      checkPrdBudgetRequested ||
      checkIssuesRequested
    ) {
      const { app, config } = loadLoreApp();
      try {
        // ---- Tree section — value-returning, no early process.exit (D5) ----
        let treeData: Record<string, unknown> = {};
        let treeInconsistent = false;
        let blueprintUnarmable = false;
        const treeRenderLines: string[] = [];
        const treeErrorLines: string[] = [];

        if (checkTreeRequested) {
          const loaded = loadTreeBlueprint(process.cwd());

          if (loaded.status === "missing") {
            blueprintUnarmable = true;
            treeErrorLines.push(`No lore.tree.yaml blueprint found at ${loaded.path}`);
          } else if (loaded.status === "invalid") {
            blueprintUnarmable = true;
            treeErrorLines.push(formatError(loaded.error));
          } else {
            // Normalize root min to 1: a declared blueprint root is always required
            // (min 1). Ensures an empty corpus is detected as inconsistent if root
            // is required.
            const blueprint = {
              ...loaded.blueprint,
              root: {
                ...loaded.blueprint.root,
                min: Math.max(loaded.blueprint.root.min, 1),
              },
            };

            if (args.fix) {
              // Run fix first, then re-check
              const fixR = await app.treeCheckService.fix(blueprint);
              if (!fixR.ok) {
                process.stderr.write(formatError(fixR.error) + "\n");
                process.exitCode = exitCode(fixR.error);
                return;
              }

              const checkR = await app.treeCheckService.checkTree(blueprint);
              if (!checkR.ok) {
                process.stderr.write(formatError(checkR.error) + "\n");
                process.exitCode = exitCode(checkR.error);
                return;
              }

              treeData = { fix: fixR.value, check: checkR.value };

              // Exit code for --fix:
              //   0 = fix ran without skips AND at most 1 non-fixable (missing) drift remains
              //       (single missing requirement treated as "fix did its best")
              //   3 = fix had explicit skips OR ≥2 non-fixable missing drifts remain
              //       (multiple missing requirements indicate "partial / cannot fully satisfy")
              const postFixDrifts = checkR.value.drifts;
              const hasMultipleMissingDrifts = postFixDrifts.filter(
                (d) => d.kind === "missing" || d.kind === "extra",
              ).length > 1;
              const fixSucceeded = !fixR.value.stillInconsistent &&
                !postFixDrifts.some(
                  (d) => d.kind === "orphan" || d.kind === "misplaced" || d.kind === "cycle",
                ) &&
                !hasMultipleMissingDrifts;
              treeInconsistent = !fixSucceeded;

              treeRenderLines.push(`Fixed ${fixR.value.fixed.length}, Skipped ${fixR.value.skipped.length}`);
              const residualDrifts = checkR.value.drifts;
              if (fixSucceeded) {
                // BUG-005 fix: exit-code semantics are UNCHANGED — a single residual
                // missing/extra drift is still "fix did its best" and stays exit 0
                // (see the `hasMultipleMissingDrifts`/`fixSucceeded` computation
                // above, Chesterton's Fence, left as-is). What was broken is the
                // TEXT rendering: the bare "Tree is consistent" line previously
                // swallowed that ≤1 residual drift entirely, making a real,
                // reported (`checkR.value.drifts`, and always correct in `--json`)
                // residual invisible in the default text output — a false-green
                // read for a human/agent scanning stdout only. The residual list
                // (kind+detail) MUST always print here, never be silently dropped.
                treeRenderLines.push("Tree is consistent with lore.tree.yaml blueprint.");
                if (residualDrifts.length > 0) {
                  treeRenderLines.push(
                    `  ${residualDrifts.length} residual drift(s) remain (not blocking, exit 0):`,
                  );
                  for (const d of residualDrifts) {
                    treeRenderLines.push(`  - ${d.kind}: ${d.detail}`);
                  }
                }
              } else {
                treeRenderLines.push(`Tree inconsistent: ${residualDrifts.length} drift(s) remain`);
                for (const d of residualDrifts) {
                  treeRenderLines.push(`  - ${d.kind}: ${d.detail}`);
                }
              }
            } else {
              // Check-only
              const checkR = await app.treeCheckService.checkTree(blueprint);
              if (!checkR.ok) {
                process.stderr.write(formatError(checkR.error) + "\n");
                process.exitCode = exitCode(checkR.error);
                return;
              }

              treeData = checkR.value as unknown as Record<string, unknown>;
              treeInconsistent = !checkR.value.consistent;

              if (checkR.value.consistent) {
                treeRenderLines.push("Tree is consistent with lore.tree.yaml blueprint.");
              } else {
                treeRenderLines.push(`Tree inconsistent: ${checkR.value.drifts.length} drift(s)`);
                for (const d of checkR.value.drifts) {
                  treeRenderLines.push(`  - ${d.kind}: ${d.detail}`);
                }
              }
            }
          }
        }

        // ---- Drift section (SPEC-045 D5) ----
        let driftPayload: CodeDriftPayload | undefined;
        if (checkDriftRequested) {
          const driftEnabled = resolveDriftEnabled(config);
          if (!driftEnabled) {
            driftPayload = disabledCodeDriftPayload();
          } else if (app.driftCheckService === undefined) {
            process.stderr.write("Error: DriftCheckService not wired on this App instance.\n");
            process.exitCode = 1;
            return;
          } else {
            const deps = buildDriftFlowDeps(app, app.driftCheckService);
            const probe = buildRealFsProbe(process.cwd());
            const driftResult = await runDrift(deps, probe);
            if (!driftResult.ok) {
              process.stderr.write(formatError(driftResult.error) + "\n");
              process.exitCode = exitCode(driftResult.error);
              return;
            }
            driftPayload = driftResult.value;
          }
        }

        const driftInconsistent = driftPayload !== undefined && driftPayload.enabled && !driftPayload.consistent;

        // ---- Requirements section (SPEC-055) ----
        // reason: computeRequirementCoverageForPrd is per-PRD; a corpus can carry >1 PRD, so
        // aggregate across every PRD. A P0 requirement uncovered by any descendant spec AC
        // drives exit 3 (same CI-gate posture as a code drift), folded into the pinned
        // precedence below. Store-only, zero-LLM, zero fs probing.
        let requirementsPayload:
          | { checked: number; consistent: boolean; prds: Array<{ slug: string; total: number; uncovered: string[]; uncovered_p0: string[] }> }
          | undefined;
        let requirementsInconsistent = false;
        if (checkRequirementsRequested) {
          const prdsResult = await app.corpusService.list({ type: "prd" });
          if (!prdsResult.ok) {
            process.stderr.write(formatError(prdsResult.error) + "\n");
            process.exitCode = exitCode(prdsResult.error);
            return;
          }
          const prds: Array<{ slug: string; total: number; uncovered: string[]; uncovered_p0: string[] }> = [];
          for (const prd of prdsResult.value.docs) {
            const covResult = await app.corpusService.computeRequirementCoverageForPrd(prd.id);
            if (!covResult.ok) {
              process.stderr.write(formatError(covResult.error) + "\n");
              process.exitCode = exitCode(covResult.error);
              return;
            }
            const cov = covResult.value;
            prds.push({ slug: prd.slug, total: cov.total, uncovered: cov.uncovered, uncovered_p0: cov.uncovered_p0 });
            if (cov.uncovered_p0.length > 0) requirementsInconsistent = true;
          }
          requirementsPayload = {
            checked: prds.length,
            consistent: !requirementsInconsistent,
            prds,
          };
        }

        // ---- PRD budget section (SPEC-080 C3) ----
        // reason: mirrors the requirements section immediately above — aggregate across
        // every PRD in the corpus, zero-LLM, zero fs probing. Detail-link target facts
        // (AC-080-10) are pre-resolved here via `corpusService.get` (a doc lookup, not a
        // filesystem probe) and handed to the pure `checkPrdBudget` as caller-injected
        // data — the check module itself never touches the store.
        let prdBudgetPayload:
          | {
              checked: number;
              consistent: boolean;
              prds: Array<{ slug: string; whole_doc_chars: number; breaches: PrdBudgetBreach[] }>;
            }
          | undefined;
        let prdBudgetInconsistent = false;
        if (checkPrdBudgetRequested) {
          const prdsResult = await app.corpusService.list({ type: "prd" });
          if (!prdsResult.ok) {
            process.stderr.write(formatError(prdsResult.error) + "\n");
            process.exitCode = exitCode(prdsResult.error);
            return;
          }
          const prds: Array<{ slug: string; whole_doc_chars: number; breaches: PrdBudgetBreach[] }> = [];
          for (const prdSummary of prdsResult.value.docs) {
            const getResult = await app.corpusService.get(prdSummary.id);
            if (!getResult.ok) {
              process.stderr.write(formatError(getResult.error) + "\n");
              process.exitCode = exitCode(getResult.error);
              return;
            }
            const doc = getResult.value.doc;

            const outlineParse = z.array(outlineEntrySchema).safeParse(doc.extra["outline"]);
            const outline = outlineParse.success ? outlineParse.data : undefined;

            const budgetParse = outlineBudgetSchema.safeParse(doc.extra["outline_budget"]);
            const budget = budgetParse.success ? toOutlineBudgetLike(budgetParse.data) : undefined;

            let detailLinkTargets: Record<string, boolean> | undefined;
            if (outline !== undefined) {
              const detailSlugs = new Set<string>();
              for (const entry of outline) {
                for (const link of entry.links) {
                  if (link.rel === "detail") detailSlugs.add(link.slug);
                }
              }
              detailLinkTargets = {};
              for (const slug of detailSlugs) {
                const targetResult = await app.corpusService.get(slug);
                detailLinkTargets[slug] = targetResult.ok && targetResult.value.doc.deleted_at === null;
              }
            }

            const checkResult = checkPrdBudget({
              raw_body: doc.content,
              outline,
              extra: doc.extra,
              budget,
              detail_link_targets: detailLinkTargets,
            });

            prds.push({ slug: doc.slug, whole_doc_chars: checkResult.whole_doc_chars, breaches: checkResult.breaches });
            if (!checkResult.consistent) prdBudgetInconsistent = true;
          }
          prdBudgetPayload = {
            checked: prds.length,
            consistent: !prdBudgetInconsistent,
            prds,
          };
        }

        // ---- Issues section (D5, spec-issue-closure-loop-computed-resolution-agent-reachable) ----
        // reason: mirrors the requirements/prd-budget sections immediately above — store-only
        // (plus one corpusService.get per issue task, same N-loop shape those two sections already
        // use), zero-LLM, zero fs probing, REPORT-ONLY (see computeIssueCheck's own header).
        let issuesPayload: IssueCheckPayload | undefined;
        let issuesInconsistent = false;
        if (checkIssuesRequested) {
          const staleAfterDays = resolveStaleAfterDays(config);
          const issuesResult = await computeIssueCheck(app, staleAfterDays);
          if (!issuesResult.ok) {
            process.stderr.write(formatError(issuesResult.error) + "\n");
            process.exitCode = exitCode(issuesResult.error);
            return;
          }
          issuesPayload = issuesResult.value;
          issuesInconsistent = !issuesPayload.consistent;
        }

        // ---- Exit precedence (D5, pinned; SPEC-055/SPEC-080/issue-closure-loop fold into the drift tier) ----
        let finalExit: number;
        if (
          treeInconsistent ||
          driftInconsistent ||
          requirementsInconsistent ||
          prdBudgetInconsistent ||
          issuesInconsistent
        ) {
          finalExit = 3;
        } else if (blueprintUnarmable) {
          finalExit = 4;
        } else {
          finalExit = 0;
        }

        // ---- Render — both requested sections always print/emit fully ----
        // reason: blueprint-missing/invalid stderr lines are written UNCONDITIONALLY
        // (regardless of --json) — matches the pre-D5-restructure behavior, which
        // wrote this message before --json was ever consulted (it used to
        // process.exit(4) immediately on a missing/invalid blueprint).
        for (const line of treeErrorLines) process.stderr.write(line + "\n");

        if (args.json) {
          const data: Record<string, unknown> = { ...treeData };
          if (driftPayload !== undefined) data["code_drift"] = driftPayload;
          if (requirementsPayload !== undefined) data["requirement_coverage"] = requirementsPayload;
          if (prdBudgetPayload !== undefined) data["prd_budget"] = prdBudgetPayload;
          if (issuesPayload !== undefined) data["issues"] = issuesPayload;
          console.log(JSON.stringify({ ok: true, data }, null, 2));
        } else {
          for (const line of treeRenderLines) console.log(line);
          if (driftPayload !== undefined) renderDriftSection(driftPayload);
          if (requirementsPayload !== undefined) {
            if (requirementsPayload.consistent) {
              console.log(`Requirement coverage: all P0 requirements covered (${requirementsPayload.checked} PRD(s) checked).`);
            } else {
              console.log(`Requirement coverage: UNCOVERED P0 requirements (${requirementsPayload.checked} PRD(s) checked):`);
              for (const prd of requirementsPayload.prds) {
                if (prd.uncovered_p0.length > 0) {
                  console.log(`  - ${prd.slug}: ${prd.uncovered_p0.join(", ")} (fix: add a spec AC with --covers <R-id>)`);
                }
              }
            }
          }
          if (prdBudgetPayload !== undefined) renderPrdBudgetSection(prdBudgetPayload);
          if (issuesPayload !== undefined) renderIssuesSection(issuesPayload);
        }

        process.exitCode = finalExit;
        return;
      } finally {
        app.close();
      }
    }

    // ── normal status branch ─────────────────────────────────────────────────
    const { app, config } = loadLoreApp();
    try {
      const result = await app.corpusService.status();

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const status = result.value;
      // SPEC-024 AC-NOAI-10: resolved per-surface AI defaults.
      const aiDefaults = computeAiDefaults(app);

      // SPEC-044 §Design Decisions D14 — open_stale_candidates, computed by the SAME
      // query `lore review --staleness --list` uses (one derivation site,
      // `flows/staleness-flow.ts::listFreshStalenessEscalates` — mirrors SPEC-043's
      // computeArmedGates precedent).
      const staleListResult = await listFreshStalenessEscalates(buildStalenessFlowDeps(app));
      if (!staleListResult.ok) {
        process.stderr.write(formatError(staleListResult.error) + "\n");
        process.exitCode = exitCode(staleListResult.error);
        return;
      }
      const openStaleCandidates = staleListResult.value.length;

      // SPEC-045 §Design Decisions D5 — store-only "declared code_anchors" count,
      // ZERO filesystem probing (unlike --check-drift). Shared helper `lore
      // bootstrap` also splices in (flows/drift-flow.ts::countArmedSpecs).
      const armedSpecsResult = await countArmedSpecs(buildListSpecs(app));
      if (!armedSpecsResult.ok) {
        process.stderr.write(formatError(armedSpecsResult.error) + "\n");
        process.exitCode = exitCode(armedSpecsResult.error);
        return;
      }
      const codeAnchorSpecs = armedSpecsResult.value;

      // SPEC-058 §Scope — discoverability for existing corpora (config-only, no IO).
      const verificationProfileKinds = configuredVerificationProfileKinds(config);

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              data: {
                ...status,
                ai_defaults: aiDefaults,
                open_stale_candidates: openStaleCandidates,
                code_anchor_specs: codeAnchorSpecs,
                verification_profiles: {
                  configured: verificationProfileKinds.length > 0,
                  kinds: verificationProfileKinds,
                },
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log("Corpus Status");
      console.log("─".repeat(40));
      console.log(`Total documents:  ${status.total_docs} (live)`);
      // reason: printed UNCONDITIONALLY, including the `0` case — unlike the
      // `open_stale_candidates` / `code_anchor_specs` lines below, which are advisories
      // that only matter when non-zero. This one is a COUNT RECONCILIATION: the line
      // above used to include retracted docs, so a reader needs to see, on every run,
      // that an exclusion was applied and by how much
      // (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #3 —
      // "an omitted count is the same silence class this whole family is about").
      console.log(
        `Retracted:        ${status.invalid_docs} (excluded from the counts above; ` +
          `see them with \`lore list --include-invalid\`)`,
      );
      console.log(
        `Last updated:     ${status.last_updated.slice(0, 19).replace("T", " ")}`,
      );
      if (status.db_size_bytes > 0) {
        const kb = (status.db_size_bytes / 1024).toFixed(1);
        console.log(`Database size:    ${kb} KB`);
      }

      if (Object.keys(status.by_type).length > 0) {
        console.log("\nBy type:");
        for (const [type, count] of Object.entries(status.by_type)) {
          console.log(`  ${type.padEnd(12)} ${count}`);
        }
      }

      if (Object.keys(status.by_status).length > 0) {
        console.log("\nBy status:");
        for (const [s, count] of Object.entries(status.by_status)) {
          console.log(`  ${s.padEnd(12)} ${count}`);
        }
      }

      // SPEC-044 §Design Decisions D14 — text line only when count > 0 (never a silent
      // zero-line noise addition to every `lore status` invocation).
      if (openStaleCandidates > 0) {
        console.log(
          `\nOpen stale candidates: ${openStaleCandidates} (run \`lore review --staleness --list\` to see them)`,
        );
      }

      // SPEC-045 §Design Decisions D5 — same "only when > 0" discipline as
      // open_stale_candidates above.
      if (codeAnchorSpecs > 0) {
        console.log(
          `\nCode anchors declared: ${codeAnchorSpecs} specs (run \`lore status --check-drift\` to verify)`,
        );
      }

      // SPEC-058 §Scope — one-line discoverability note (SPEC-044/045 armed-count
      // precedent): says WHETHER the corpus opted in, and into which spec_kinds,
      // never dumping the profiles' full oracle-requirement content.
      console.log(
        verificationProfileKinds.length > 0
          ? `\nVerification profiles: configured (kinds: ${verificationProfileKinds.join(", ")})`
          : "\nVerification profiles: not configured",
      );

      // SPEC-043 D8 — invalidated-feeding-source warning (computed via the SAME
      // armed-gate helper SessionService.bootstrap uses; see CorpusService.status).
      if (status.invalidated_feeding_source_warnings.length > 0) {
        console.log("\n⚠ Invalidated feeding sources:");
        for (const warning of status.invalidated_feeding_source_warnings) {
          console.log(`  - ${warning}`);
        }
      }

      // SPEC-080 §C4 — exempt-plans surfacing (AC-080-5). `[]` renders NO lines
      // at all (see renderExemptPlansSection's own JSDoc), so a corpus with zero
      // prd_sync_exempt plans prints byte-identically to pre-SPEC-080.
      const exemptPlansLines = renderExemptPlansSection(status.exempt_plans);
      if (exemptPlansLines.length > 0) {
        console.log("");
        for (const line of exemptPlansLines) {
          console.log(line);
        }
      }

      // SPEC-024 AC-NOAI-10: show resolved per-surface AI defaults
      console.log("\nAI defaults (per surface):");
      for (const [surface, aiOn] of Object.entries(aiDefaults)) {
        const current = surface === app.callerSurface ? " ← current" : "";
        console.log(`  ${surface.padEnd(14)} ${aiOn ? "on" : "off"}${current}`);
      }
      console.log("  (override via --ai / --no-ai, or LORE_AI_DEFAULT=off, or ai.default_per_surface in config)");
    } finally {
      app.close();
    }
  },
});
