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
 *   ALSO reports WHOSE ceilings those are: when `.lore/config.yaml` cannot be
 *   parsed and its `context` sub-tree cannot be salvaged either, the check
 *   runs on schema defaults and says so — a stderr notice plus
 *   `budget_source`/`budget_substitution` in `--json`
 *   (task-lore-status-check-claude-md-silently-runs-on-schema; it used to
 *   substitute them in total silence, so exit 0 could mean "within the
 *   defaults" while the operator's own stricter budget was breached). ⛔ The
 *   exit code deliberately does NOT change for a substitution — see
 *   `formatMemoryFileBudgetSubstitution`'s doc for the two shipped hooks that
 *   fail open on any undocumented verdict.
 * With --check-memory-pointers: verify every backtick-quoted corpus-slug
 *   pointer inside project memory files resolves against THIS corpus
 *   (spec-claude-md-governance-content-dimension-checks-wire-the, Phase 2,
 *   N14) — a NEW flag joining the app-backed --check-* family below (it
 *   needs the corpus, unlike --check-claude-md, which is corpus-free and
 *   hardcodes every slug as "existing" so the check structurally never fires
 *   there). Breach → exit 3, folded into the SAME exit-precedence tier as
 *   --check-drift/--check-requirements/--check-prd-budget/--check-issues.
 * With --json: output check result(s) as a JSON envelope.
 *
 * The PLAIN run (no --check-* flag) additionally reports, UNCONDITIONALLY and
 * report-only (spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1
 * surfacing, AC-FALS-6/10): a corpus-wide `pass_unfalsified_count` (criteria that
 * are green but were never once observed able to go red — `deriveAcCoverageState`,
 * `@lore/core`), and an `unclaimed_oracle` report (M3 — a `-t`/`--testNamePattern`
 * value present in a repo test file that no declared AC binds, via `scripts/check-
 * unclaimed-oracle.ts`'s exported pure functions), and an
 * `unredeemed_allow_missing_path_count` (spec-oracle-executability-a-runner-
 * s-discovery-refusal-is-not-a §D8, AC-OX-10 — D8 `--allow-missing-path`
 * escape declarations whose declared script-mode command still names a path
 * absent from disk, via `AcService.countUnredeemedAllowMissingPath`), and a
 * `capture_source_runner_count`/`capture_source_self_report_count` pair
 * (task-raise-the-evidence-tail-guard-s-predicate-to-its-own, AC-FR-5, G4 —
 * the corpus-wide runner-vs-self-report evidence distribution). ⛔ NONE of
 * these may change `process.exitCode` — see `collectFalsifiabilitySignals`'s,
 * `listUnredeemedAllowMissingPathDeclarations`'s, and
 * `collectCaptureSourceMembers`'s own JSDoc. Every one of these `*_count`
 * fields has a matching entry in `COUNT_FIELD_ENUMERATORS` below, reachable
 * via `lore status --enumerate <field>` (AC-FR-5's own binding-on-future-
 * counts requirement) — a new count with no enumerator is the exact gap that
 * flag exists to make impossible to ship silently. `code_anchor_specs` (the
 * SPEC-045 D5 declared-anchor count, reported by the plain run alongside them)
 * is registered there too as of AC-BFI-4 (spec-bootstrap-fixpoint-integrity-
 * binary-provenance-an-anchor): the anchor-coverage ratchet's own population
 * must be READABLE, not merely countable, and it is enumerated through this
 * one seam rather than a parallel bespoke coverage block.
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
 * --check-issues/--check-memory-pointers in one combined run (spec Module
 * Boundary invariant 2: this check must never reach `loadLoreApp`/
 * `bun:sqlite`, so it cannot share the app-backed branch those six flags
 * fold into — --check-memory-pointers is the ONE flag in that family that
 * NEEDS the corpus, per N14). Passing --check-claude-md alongside any of
 * those flags runs ONLY the memory-file check; see that branch for exit
 * codes.
 *
 * --check-binary-provenance is likewise standalone, and sits AHEAD of every
 * other flag in this command (spec-bootstrap-fixpoint-integrity-binary-
 * provenance-an-anchor, AC-BFI-2): it answers "was this verdict issued by a
 * binary built from this source?", which conditions the trustworthiness of
 * every other verdict, and it needs only the cwd's git repo — never the corpus.
 * Exit codes, all EXACT: dev-synced 0 · dev-stale 3 (naming BOTH shas) ·
 * not-a-dev-checkout 0 with the literal token `skipped` · running from source 0
 * with `skipped` · a COMPILED binary carrying no provenance 4 (a build defect,
 * deliberately not folded into `skipped`). Rationale for the five-state /
 * three-exit split, and for why a dirty tree at HEAD stays dev-synced, lives in
 * `service/binary-provenance.ts`'s D1/D2 header blocks.
 *
 * With --check-baseline: product-baseline integrity (registry <-> leaf consistency, rules on a
 *   non-leaf node, dangling depends_on). Any finding -> exit 3; composes with the other
 *   app-backed --check-* flags (baseline slice 1 §C7). The PLAIN run's `--json` gains a
 *   `baseline` block ONLY when the corpus has a live baseline doc or an AC carrying `cites`
 *   (rollback invariant AC-BLS1-8), plus one default-output line when a warning count is non-zero.
 *
 * Dispatch precedence inside this command, highest first:
 *   --check-binary-provenance → --enumerate → --check-claude-md →
 *   the app-backed --check-* family → the plain run.
 * The first three are mutually exclusive by design (each returns), so combining
 * them runs only the highest; the app-backed family composes internally as
 * documented above. This precedence is asserted by
 * `tests/integration/binary-provenance-check.test.ts`.
 */

import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { AcService } from "../../../service/ac-service.js";
import { buildStalenessFlowDeps, listFreshStalenessEscalates } from "../../../flows/staleness-flow.js";
import { loadTreeBlueprint } from "../../../flows/blueprint-flow.js";
import {
  buildDriftFlowDeps,
  buildListSpecs,
  countArmedSpecs,
  disabledCodeDriftPayload,
  isSpecAnchored,
  renderDriftSectionLines,
  runDrift,
  type CodeDriftPayload,
} from "../../../flows/drift-flow.js";
import { buildRealFsProbe } from "../../real-fs-probe.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { RuleStateService } from "../../../service/rule-state-service.js";
import { SpawnGitPort, resolveGitRoot } from "../../../service/rule-state-git-port.js";
import {
  baselineWarningCount,
  computeBaselineStatus,
  findBaselineIntegrityFindings,
  type BaselineFinding,
  type BaselineStatus,
} from "../../../service/baseline-status.js";
import {
  deriveAcCoverageState,
  err,
  extractEvidence,
  formatMemoryFileBudgetSubstitution,
  ok,
  resolveDriftEnabled,
  resolveMemoryFileBudgets,
  resolveMemoryFileBudgetsFromConfigResult,
  resolveStaleAfterDays,
  SPEC_KINDS,
  outlineEntrySchema,
  outlineBudgetSchema,
} from "@lore/core";
import type {
  CallerSurface,
  LoreConfig,
  LoreError,
  MemoryFileBudgetResolution,
  OutlineBudget,
  Result,
} from "@lore/core";
import { z } from "zod";
import {
  checkPrdBudget,
  type OutlineBudgetLike,
  type PrdBudgetBreach,
} from "../../../service/prd-budget-check.js";
import {
  BINARY_PROVENANCE_EXIT_CODES,
  classifyBinaryProvenance,
  createRealGitProvenanceProbe,
  formatBinaryProvenanceStatusLine,
  gatherBinaryProvenanceFacts,
  isCompiledBinary,
  provenanceOrNull,
  readEmbeddedBuildProvenance,
  renderBinaryProvenanceVerdict,
} from "../../../service/binary-provenance.js";
import { renderExemptPlansSection } from "../../../flows/status-prd-sync-flow.js";
import {
  computeIssueResolution,
  hasIssueReport,
  isDanglingAdoption,
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
import { runMemoryFileChecks } from "../../../service/claude-md-admission.js";
import type { MemoryFileFinding } from "../../../service/claude-md-findings.js";
import {
  buildCheckClaudeMdJsonPayload,
  formatCheckClaudeMdHuman,
  formatAdoptionDowngradeLines,
  type CheckClaudeMdRenderInput,
} from "../claude-md-render.js";

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
 * Every drift row names the DOC TYPE its anchor came from, so a knowledge breach in
 * a mixed report can never be read as a spec breach.
 *
 * A thin `console.log` wrapper over `renderDriftSectionLines` (`flows/drift-flow.js`)
 * — the actual line-building logic lives THERE, not here, so a plain vitest test
 * can call it directly (this file transitively imports `loader.js` → `bun:sqlite`,
 * unresolvable under vitest — see that function's own doc for why).
 */
function renderDriftSection(payload: CodeDriftPayload): void {
  for (const line of renderDriftSectionLines(payload)) {
    console.log(line);
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
 * Defensive `extra.issue_report.reported_at` reader — mirrors the same
 * null/array/typeof guard shape every defensive `extra.issue_report` reader
 * in this codebase uses (duplicated rather than imported: every such reader
 * is scoped to a different field for a different caller, and
 * `extra.issue_report` is deliberately untyped passthrough — see
 * `packages/core/src/issue-report.ts`'s own header). A malformed/legacy
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
 * `--check-memory-pointers`'s `{checked, consistent, ...}` result shape
 * (Phase 2, N14, spec-claude-md-governance-content-dimension-checks-wire-the)
 * — mirrors the requirements/prd-budget/issues sections' own convention.
 * `findings` is `runMemoryFileChecks(...).deterministic` UNCHANGED (every
 * deterministic kind, not filtered to `slug_pointer_missing` alone — the
 * SAME composition entry `--check-claude-md` consumes, differing only in
 * which `docExists` predicate was injected).
 */
interface MemoryPointersPayload {
  checked: number;
  consistent: boolean;
  findings: MemoryFileFinding[];
  /** Pre-rendered `WARN adoption=warn` + downgraded lines (empty unless warn downgraded something); never exit-relevant. */
  adoption_lines: string[];
}

/** Text rendering for the `--check-memory-pointers` section (Phase 2, N14). */
function renderMemoryPointersSection(payload: MemoryPointersPayload): void {
  if (payload.consistent) {
    console.log(`Memory pointers: within budget (${payload.checked} memory file(s) checked).`);
    for (const line of payload.adoption_lines) console.log(line);
    return;
  }
  console.log(`Memory pointers: BREACHED (${payload.checked} memory file(s) checked):`);
  for (const finding of payload.findings) {
    console.log(`  - ${finding.message}`);
  }
  for (const line of payload.adoption_lines) console.log(line);
}

/**
 * Resolves the effective `context.memory_files.*` budgets for
 * `--check-claude-md` from `<cwd>/.lore/config.yaml`, WITH their provenance.
 *
 * ⛔ Thin pipe by design — every resolution rule (including the deliberate
 * "config-only" tolerance of a `.lore/config.yaml` that is invalid everywhere
 * except its `context:` block) lives in `@lore/core`'s
 * {@link resolveMemoryFileBudgetsFromConfigResult}, the single admission seam
 * shared with `commands/context.ts`. This function previously held a private
 * copy of those rules ending in a bare `resolveMemoryFileBudgets(undefined)`,
 * and `commands/context.ts` held a byte-identical second copy — so a config
 * whose `context` sub-tree failed to parse handed BOTH commands schema
 * defaults with no signal at all. ⛔ Do not re-inline the rules here: two
 * copies is how the silence survived a fix at one consumer
 * (task-lore-status-check-claude-md-silently-runs-on-schema).
 *
 * @param cwd - Directory to resolve `.lore/config.yaml` from.
 * @returns The resolved budgets plus the `source` that produced them.
 */
function resolveClaudeMdBudgets(cwd: string): MemoryFileBudgetResolution {
  return resolveMemoryFileBudgetsFromConfigResult(loadConfig(cwd));
}

// ── Falsifiability surfacing (spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1 surfacing) ──

/**
 * `App.acService` is typed optional only to keep pre-existing hand-built App test
 * stubs compiling — mirrors `commands/ac.ts::requireAcService`'s own JSDoc.
 * `loadLoreApp()` (this command's only App source) always returns a fully-wired
 * App from `createApp`, so this assertion never actually fires in the CLI.
 */
function requireAcServiceForStatus(app: ReturnType<typeof loadLoreApp>["app"]): AcService {
  if (app.acService === undefined) {
    throw new Error("Internal error: AcService not wired on App");
  }
  return app.acService;
}

/**
 * Corpus-wide count of UNREDEEMED `--allow-missing-path` D8 escape
 * declarations (spec-oracle-executability-a-runner-s-discovery-refusal-is-
 * not-a §D8, task-wire-allow-missing-path-and-the-unredeemed-declaration) —
 * an AC that exercised the D8 escape at declaration time (`lore ac add`/
 * `ac set --allow-missing-path`) whose declared script-mode command STILL
 * names a path absent from disk. PRODUCTION wiring for
 * `AcService.countUnredeemedAllowMissingPath`, which landed service-layer-
 * only and unit-tested (task-promote-the-oracle-file-existence-primitives-
 * into-lore) but was unreachable from a real `lore status --json` invocation
 * until this call site started supplying its REQUIRED filesystem context.
 *
 * This function only supplies the REAL `fs.existsSync`/cwd/corpusRoot
 * context — the SAME shape `commands/ac.ts::buildDeclarePathOpts` passes at
 * declaration time (`corpusRoot` derived identically: `dbPath` is always
 * `<corpusRoot>/.lore/lore.db`, two directories up) — and delegates the
 * count itself entirely to the service, which recomputes fresh from the live
 * filesystem on every call (never cached): creating the previously-missing
 * file drops this count on the very next `lore status` run, no further
 * command needed.
 *
 * @param app - Wired App instance.
 * @param dbPath - The discovered `.lore/lore.db` path `loadLoreApp()` returns.
 * @returns the MEMBER LIST (task-raise-the-evidence-tail-guard-s-predicate-
 *   to-its-own, AC-FR-5) — `unredeemed_allow_missing_path_count` (this
 *   file's normal-status branch, and the `--enumerate` registry below) both
 *   derive their number from THIS list's `.length`, never a separately
 *   maintained counter — `AcService.listUnredeemedAllowMissingPath` is the
 *   ONE iteration.
 */
async function listUnredeemedAllowMissingPathDeclarations(
  app: ReturnType<typeof loadLoreApp>["app"],
  dbPath: string,
): Promise<Result<string[], LoreError>> {
  const acService = requireAcServiceForStatus(app);
  return acService.listUnredeemedAllowMissingPath({
    fileExists: existsSync,
    cwd: process.cwd(),
    corpusRoot: dirname(dirname(dbPath)),
  });
}

/**
 * Corpus-wide `pass_unfalsified` coverage-state count (AC-FALS-6) PLUS every
 * declared script-mode AC command (fed to {@link runUnclaimedOracleCheck} below) —
 * ONE spec iteration serves both, since `AcService.listCriteria` already returns
 * both `criteria` (declared, always present) and `coverage` (evidence facts,
 * `null` when no plan / no ad-hoc-governed task exists at all) per spec.
 *
 * ⛔ Consumes `deriveAcCoverageState` (`@lore/core`) — the SAME SSOT
 * `commands/ac.ts::coverageBadge` reads — never re-derives the fail-first
 * precedence or re-counts `falsified` here; that is the ONE precedence site this
 * codebase shares (see `acceptance.ts`'s own module header) and a second copy is
 * exactly the SSOT fork this codebase has been bitten by before.
 *
 * Report-only (governing spec's §Out-of-scope "Blocking on pass_unfalsified" —
 * 574/700 existing criteria are grandfathered by that WRITTEN exemption, never by
 * a synthesized red run): the caller MUST NOT let either returned number influence
 * `process.exitCode`.
 *
 * @returns `passUnfalsifiedMembers` (task-raise-the-evidence-tail-guard-s-
 *   predicate-to-its-own, AC-FR-5) — one `"<spec-slug>#<ac-id>"` entry per
 *   criterion in the `pass_unfalsified` state, so `pass_unfalsified_count`
 *   (this file's own `.length` of this array, never a separately-tallied
 *   counter) has an ENUMERATOR: measured 2026-08-10, producing this exact
 *   list for `pass_unfalsified_count=29` required a throwaway script
 *   iterating all 138 specs by hand because no enumerator existed.
 */
async function collectFalsifiabilitySignals(
  app: ReturnType<typeof loadLoreApp>["app"],
): Promise<
  Result<{ passUnfalsifiedMembers: string[]; declaredScriptCommands: string[] }, LoreError>
> {
  const acService = requireAcServiceForStatus(app);
  const specsResult = await app.corpusService.list({ type: "spec" });
  if (!specsResult.ok) return specsResult;

  const passUnfalsifiedMembers: string[] = [];
  const declaredScriptCommands: string[] = [];

  for (const specSummary of specsResult.value.docs) {
    const listResult = await acService.listCriteria(specSummary.slug);
    if (!listResult.ok) return listResult;

    for (const criterion of listResult.value.criteria) {
      if (criterion.verify.mode === "script") {
        declaredScriptCommands.push(criterion.verify.command);
      }
    }

    if (listResult.value.coverage !== null) {
      for (const fact of listResult.value.coverage) {
        if (deriveAcCoverageState(fact) === "pass_unfalsified") {
          passUnfalsifiedMembers.push(`${specSummary.slug}#${fact.ac_id}`);
        }
      }
    }
  }

  return ok({ passUnfalsifiedMembers, declaredScriptCommands });
}

/**
 * Corpus-wide `capture_source` distribution (task-raise-the-evidence-tail-
 * guard-s-predicate-to-its-own, AC-FR-5) — every evidence entry across every
 * task AND phase doc, bucketed into `"runner"` vs everything else. A LEGACY
 * row with `capture_source` entirely ABSENT reads as self-report (never as
 * "unknown, therefore fine" — the SAME convention `task-workflow-service.ts`'s
 * own `capture_source` invariant documents at every other consumption site).
 * Members are `"<doc-slug>#<n>"` (`n` = the entry's index within that doc's
 * own `verification_evidence` array) — stable enough to locate the exact row
 * via `lore get <doc-slug> --json`.
 *
 * `lore status --json`'s `capture_source_runner_count`/
 * `capture_source_self_report_count` (below) and this file's `--enumerate`
 * registry both derive their numbers from THIS list's lengths — one corpus
 * scan, never two independently-tallied counters.
 */
async function collectCaptureSourceMembers(
  app: ReturnType<typeof loadLoreApp>["app"],
): Promise<Result<{ runner: string[]; selfReport: string[] }, LoreError>> {
  const runner: string[] = [];
  const selfReport: string[] = [];

  for (const type of ["task", "phase"] as const) {
    const listResult = await app.corpusService.listFull({ type });
    if (!listResult.ok) return listResult;

    for (const doc of listResult.value.docs) {
      const entries = extractEvidence(doc);
      entries.forEach((entry, index) => {
        const member = `${doc.slug}#${index}`;
        if (entry.capture_source === "runner") {
          runner.push(member);
        } else {
          selfReport.push(member);
        }
      });
    }
  }

  return ok({ runner, selfReport });
}

/**
 * The MEMBER LIST behind `lore status --json`'s `code_anchor_specs` — every
 * LIVE spec that DECLARES at least one `extra.code_anchors` entry, by slug,
 * sorted (spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor,
 * AC-BFI-4). Before this existed, `code_anchor_specs` was a bare number: the
 * anchor-coverage ratchet's own population could be counted but not READ, so
 * "which specs are anchored?" required a throwaway script — the exact shape
 * AC-FR-5 forbids, sitting on the field this slice ratchets.
 *
 * ⛔ "LIVE spec" here is NOT a new definition — it is
 * `corpusService.listFull({type: "spec"})`, bound by `buildListSpecs`, which is
 * the SAME query `countArmedSpecs` consumes for the published count and the SAME
 * population `scripts/check-anchor-coverage.ts` (the ratchet) and
 * `scripts/export-spec-mirror.ts` name. `store.findMany` defaults
 * `exclude_deleted: true` and applies no invalidation filter, so this census can
 * never be wrong by a hidden invalidated population. A second definition of
 * "live spec" is precisely the defect this seam exists to prevent.
 *
 * ⛔ The membership predicate below is `flows/drift-flow.ts::isSpecAnchored` —
 * the ONE production definition (spec-bootstrap-fixpoint-integrity-binary-
 * provenance-an-anchor AC-BFI-14; this call site used to hand-write a second
 * copy of the same two-line test, a THIRD copy alongside `check-anchor-
 * coverage.ts`'s, undocumented until AC-BFI-14's repo-wide scan found it).
 * `isSpecAnchored` classifies; `countArmedSpecs` counts over the identical
 * predicate. This seam needs the SET, so the SAME spec list is still fed
 * BACK through `countArmedSpecs` and a disagreement is a loud `STORE_ERROR`
 * (CLI exit 1) rather than a silently drifted member list — the identical
 * cross-check `check-anchor-coverage.ts::runCheck` performs, for the identical
 * reason. Post-AC-BFI-14 both sides call the same `isSpecAnchored` export over
 * the same array, so this can only fire on a FUTURE hand-edit that bypasses the
 * import at one of the two sites — the repo-wide uniqueness scan
 * (`anchor-coverage-ratchet.test.ts`'s `anchored-predicate-ssot` suite) catches
 * that regression statically. Zero extra corpus reads: the second pass walks
 * the already-fetched array.
 *
 * @param app - A wired `App` instance
 * @returns Sorted slugs of every anchor-declaring live spec; `code_anchor_specs`
 *   is this list's `.length` at both the `--json` and the `--enumerate` surface.
 */
async function collectCodeAnchorSpecMembers(
  app: ReturnType<typeof loadLoreApp>["app"],
): Promise<Result<string[], LoreError>> {
  const specsResult = await buildListSpecs(app)();
  if (!specsResult.ok) return specsResult;
  const specs = specsResult.value;

  const members = specs
    .filter(isSpecAnchored)
    .map((spec) => spec.slug)
    .sort();

  const sharedCountResult = await countArmedSpecs(() => Promise.resolve(ok(specs)));
  if (!sharedCountResult.ok) return sharedCountResult;
  if (sharedCountResult.value !== members.length) {
    return err({
      code: "STORE_ERROR",
      message:
        `code_anchor_specs: this command's anchored-spec member list holds ${members.length} spec(s) but the shared ` +
        `flows/drift-flow.ts::countArmedSpecs counted ${sharedCountResult.value} over the SAME ${specs.length} live ` +
        `spec(s) — one of the two call sites has bypassed the shared isSpecAnchored predicate; reconcile before trusting either number.`,
    });
  }

  return ok(members);
}

/**
 * The MEMBER LIST behind `lore status --json`'s `adopted_abandoned_count`
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M7, AC-DC-16) —
 * every filed issue report `isDanglingAdoption` (`service/issue-resolution.js`,
 * the ONE judgment this function defers to rather than re-deriving) rules a
 * DANGLING adoption. This function's only job is assembling that predicate's
 * two inputs per report, both read fresh (never cached from write time,
 * because the pointer must "stay honest after the fact"):
 *
 *   - `computedResolution` — `computeIssueResolution` over the report's
 *     `extra` plus its CURRENT `resolves` in-edges (the SAME per-doc
 *     derivation `collectCodeAnchorSpecMembers`'s sibling read surfaces use).
 *     A report a real fix has since landed on computes `fixed`/`resolving`,
 *     not `adopted`, EVEN THOUGH its stored `resolution.state` field still
 *     literally says `adopted` — `isDanglingAdoption`'s own JSDoc explains why
 *     that is correct, not a bug.
 *   - `ownerStatus` — the CURRENT lifecycle status of the doc
 *     `resolution.adopted_by` names, or `undefined` when that pointer is
 *     absent (malformed/legacy `extra`) or no longer resolves (the owner doc
 *     was deleted).
 *
 * Same "N candidates -> N per-doc `get()` calls" CLI-scale trade-off
 * `commands/issues.ts::readLocalRows` already documents for the identical
 * resolves-edge read.
 *
 * @param app - a wired `App` instance
 * @returns sorted slugs of every dangling adoption; `adopted_abandoned_count`
 *   is this list's `.length` at both the `--json` and the `--enumerate` surface
 */
async function collectAdoptedAbandonedMembers(
  app: ReturnType<typeof loadLoreApp>["app"],
): Promise<Result<string[], LoreError>> {
  const listResult = await app.corpusService.listFull({ type: "task" });
  if (!listResult.ok) return listResult;

  const issueTasks = listResult.value.docs.filter((d) => hasIssueReport(d.extra));
  const members: string[] = [];

  for (const task of issueTasks) {
    const getResult = await app.corpusService.get(task.id);
    // reason: a task that matched listFull() but vanished before this
    // per-doc get() (deleted between the two calls) degrades to "excluded
    // from this census" rather than aborting the whole command — the same
    // graceful-partial-result shape `readLocalRows` accepts for its own
    // per-doc lookup loop.
    if (!getResult.ok) continue;

    const resolvesInEdges = getResult.value.navigation.related.filter((r) => r.link_type === "resolves");
    const computed = computeIssueResolution(
      task,
      resolvesInEdges.map((r) => ({ from_id: r.id })),
      resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
    );

    const issueReport = task.extra["issue_report"] as Record<string, unknown> | undefined;
    const resolution = issueReport?.["resolution"] as Record<string, unknown> | undefined;
    const adoptedBy = typeof resolution?.["adopted_by"] === "string" ? (resolution["adopted_by"] as string) : undefined;
    // reason: `adopted_by` is REQUIRED at write time (AC-DC-15) — an absent
    // value here means a malformed/legacy `extra`, not a live report; the
    // owner-status lookup below degrades to `undefined` in that case, which
    // `isDanglingAdoption` already treats as "not abandoned" (never crash).
    const ownerResult = adoptedBy === undefined ? undefined : await app.corpusService.get(adoptedBy);
    // reason: the owner doc no longer resolves (deleted, or never declared) —
    // cannot assert "archived/deprecated" about a doc that does not exist;
    // `isDanglingAdoption` treats an `undefined` owner status as excluded.
    const ownerStatus = ownerResult?.ok === true ? ownerResult.value.doc.status : undefined;

    // §M7, AC-DC-16 — the ONE dangling-claim judgment, never re-derived here.
    if (!isDanglingAdoption({ computedResolution: computed, ownerStatus })) continue;

    members.push(task.slug);
  }

  return ok(members.sort());
}

/**
 * SSOT registry mapping every COUNT field `lore status --json` reports to the
 * function that ENUMERATES its members (task-raise-the-evidence-tail-guard-s-
 * predicate-to-its-own, AC-FR-5). `lore status --enumerate <field>` (below) and
 * the normal-status branch's own displayed counts BOTH consume this registry — a
 * count is never computed independently of its enumerator, so
 * `count === enumerator().length` holds by construction, not by convention.
 * ⛔ Adding a new count field WITHOUT a matching entry here is the exact gap
 * AC-FR-5 exists to close — `lore status --enumerate <that-field>` will refuse
 * with VALIDATION_ERROR naming it, which is the generic test's own RED (b) case.
 *
 * ⛔ Registry membership is keyed on being a COUNT, never on the `_count`
 * SUFFIX: `code_anchor_specs` (AC-BFI-4) is a count whose name predates this
 * seam, and reading the naming convention as the rule is how it shipped for
 * months as a bare number nobody could enumerate. A renamed field would have
 * broken every existing consumer, so the registry accommodates the name.
 */
const COUNT_FIELD_ENUMERATORS: Record<
  string,
  (app: ReturnType<typeof loadLoreApp>["app"], dbPath: string) => Promise<Result<string[], LoreError>>
> = {
  pass_unfalsified_count: async (app) => {
    const signalsResult = await collectFalsifiabilitySignals(app);
    if (!signalsResult.ok) return signalsResult;
    return ok(signalsResult.value.passUnfalsifiedMembers);
  },
  unredeemed_allow_missing_path_count: async (app, dbPath) =>
    listUnredeemedAllowMissingPathDeclarations(app, dbPath),
  capture_source_runner_count: async (app) => {
    const membersResult = await collectCaptureSourceMembers(app);
    if (!membersResult.ok) return membersResult;
    return ok(membersResult.value.runner);
  },
  capture_source_self_report_count: async (app) => {
    const membersResult = await collectCaptureSourceMembers(app);
    if (!membersResult.ok) return membersResult;
    return ok(membersResult.value.selfReport);
  },
  code_anchor_specs: async (app) => collectCodeAnchorSpecMembers(app),
  adopted_abandoned_count: async (app) => collectAdoptedAbandonedMembers(app),
};

/**
 * Narrow hand-typed surface of `scripts/check-unclaimed-oracle.ts`'s exports this
 * command consumes — the SAME two functions `tests/unit/service/unclaimed-
 * oracle.test.ts` already imports this exact way (a dynamic import with a
 * NON-literal specifier, see {@link resolveUnclaimedOracleScriptPath}'s own
 * JSDoc for why a static `import` cannot be used here).
 */
type UnclaimedOracleCheckModule = {
  collectRepoTestFiles: (repoRoot: string) => Array<{ path: string; content: string }>;
  findUnclaimedOracleValues: (
    testFiles: readonly { path: string; content: string }[],
    declaredCommands: readonly string[],
  ) => {
    readonly scannedTestFiles: number;
    readonly scannedCandidateValues: number;
    readonly scannedDeclaredCommands: number;
    readonly scannedClaimedBindings: number;
    readonly findings: readonly { readonly file: string; readonly value: string }[];
  };
};

/**
 * Locates `scripts/check-unclaimed-oracle.ts` on disk relative to however THIS
 * command's own module is currently running:
 *  - SOURCE entry (`bun run packages/lore/src/index.ts ...`) — `import.meta.url` is
 *    a real file path; walk up from this file's own directory to the repo root.
 *  - COMPILED `dist/lore` binary — `import.meta.url` resolves to a synthetic
 *    `bunfs://`-shaped path, unusable for relative resolution; `process.execPath`
 *    instead gives the REAL on-disk path of the running executable, and this
 *    project's own `bun run build` always lays it out at `<repoRoot>/dist/lore` —
 *    empirically confirmed a compiled bun binary CAN `await import()` an external
 *    sibling `.ts` file resolved this way (no bundling required; resolved fresh
 *    off disk at runtime, so no staleness risk either).
 *
 * Returns `undefined` when NEITHER candidate exists on disk — e.g. a `lore`
 * install with no companion source checkout — so the caller degrades gracefully
 * instead of throwing: M3 is a lore-monorepo-only dogfooding mechanism (it scans
 * THIS repo's OWN `packages/*\/tests/**` convention), opt-in by presence, never a
 * hard requirement for `lore status` to run.
 */
function resolveUnclaimedOracleScriptPath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourceCandidate = join(here, "..", "..", "..", "..", "..", "..", "scripts", "check-unclaimed-oracle.ts");
  if (existsSync(sourceCandidate)) return sourceCandidate;

  const compiledCandidate = join(dirname(dirname(process.execPath)), "scripts", "check-unclaimed-oracle.ts");
  if (existsSync(compiledCandidate)) return compiledCandidate;

  return undefined;
}

/** `lore status --json`'s `unclaimed_oracle` payload shape (AC-FALS-10). */
interface UnclaimedOracleStatusPayload {
  available: boolean;
  scanned_test_files: number;
  scanned_candidate_values: number;
  scanned_declared_commands: number;
  scanned_claimed_bindings: number;
  findings: Array<{ file: string; value: string }>;
}

/**
 * Runs the M3 unclaimed-oracle cross-reference (AC-FALS-8/10) against
 * `declaredScriptCommands` (every spec-declared script-mode AC command in the
 * CURRENT corpus, gathered by {@link collectFalsifiabilitySignals}) and every test
 * file under `process.cwd()`'s own `packages/*\/tests/**`/`scripts/**` convention.
 *
 * ⛔ Consumes `collectRepoTestFiles`/`findUnclaimedOracleValues` from
 * `scripts/check-unclaimed-oracle.ts` verbatim — never re-implements the file scan
 * or the cross-reference match. Loaded via a NON-literal dynamic `import()`
 * specifier (the SAME technique `tests/unit/service/unclaimed-oracle.test.ts`
 * already establishes): `scripts/` sits outside `packages/lore/tsconfig.json`'s
 * declared `rootDir` ("src"), so a STATIC import fails `tsc --noEmit -p
 * packages/lore/tsconfig.json` with TS6059 — empirically confirmed a computed
 * (non-literal) specifier sidesteps tsc's static module-graph inclusion entirely.
 *
 * Report-only, never throws: `declaredCommands` is supplied by the caller from the
 * ALREADY-open corpus (never re-fetched via a `lore` subprocess), so this function
 * never reaches that module's own `LoreInvocationError` path
 * (`collectDeclaredAcCommands`-only, unused here).
 */
async function runUnclaimedOracleCheck(
  declaredScriptCommands: readonly string[],
): Promise<UnclaimedOracleStatusPayload> {
  const scriptPath = resolveUnclaimedOracleScriptPath();
  if (scriptPath === undefined) {
    return {
      available: false,
      scanned_test_files: 0,
      scanned_candidate_values: 0,
      scanned_declared_commands: 0,
      scanned_claimed_bindings: 0,
      findings: [],
    };
  }

  const mod = (await import(scriptPath)) as UnclaimedOracleCheckModule;
  const testFiles = mod.collectRepoTestFiles(process.cwd());
  const report = mod.findUnclaimedOracleValues(testFiles, declaredScriptCommands);

  return {
    available: true,
    scanned_test_files: report.scannedTestFiles,
    scanned_candidate_values: report.scannedCandidateValues,
    scanned_declared_commands: report.scannedDeclaredCommands,
    scanned_claimed_bindings: report.scannedClaimedBindings,
    findings: report.findings.map((f) => ({ file: f.file, value: f.value })),
  };
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
    "check-memory-pointers": {
      type: "boolean",
      description:
        "Verify every backtick-quoted corpus-slug pointer inside project memory files resolves against this corpus (spec-claude-md-governance-content-dimension-checks-wire-the, N14). Loads the corpus DB — unlike --check-claude-md, which cannot resolve a slug. Breach → exit 3. Composes with --check-tree/--check-drift/--check-requirements/--check-prd-budget/--check-issues.",
    },
    "check-baseline": {
      type: "boolean",
      description:
        "Verify the product-baseline tree: registry <-> leaf rule ids agree, no rule sits on a non-leaf node, every depends_on names an existing rule. Any finding -> exit 3 (each is printed). Composes with --check-tree/--check-drift/--check-requirements/--check-prd-budget/--check-issues/--check-memory-pointers.",
    },
    "check-binary-provenance": {
      type: "boolean",
      description:
        "Compare THIS binary's embedded build commit against the cwd repo. dev-synced → 0; dev-stale (built from another commit of this repo) → 3, naming both shas; not a dev checkout (build commit unknown here, e.g. an installed lore) → 0, 'skipped'. Git-only, never loads the corpus DB. Standalone — takes precedence over every other flag.",
    },
    enumerate: {
      type: "string",
      description:
        "Enumerate the MEMBERS behind a count field the plain run reports (e.g. pass_unfalsified_count, unredeemed_allow_missing_path_count, capture_source_runner_count, capture_source_self_report_count, code_anchor_specs, adopted_abandoned_count). Unknown field → exit 4, naming it and the known set.",
    },
  },
  async run({ args }) {
    // ── check-binary-provenance branch (spec-bootstrap-fixpoint-integrity-
    // binary-provenance-an-anchor, AC-BFI-2) ────────────────────────────────
    // reason: dispatched FIRST, ahead of --enumerate and --check-claude-md.
    // Every other verdict this process can issue is only as trustworthy as the
    // binary issuing it, so "is this binary built from this source?" is the one
    // question that must be answerable before any other flag runs. Standalone
    // like --check-claude-md and for the same Module-Boundary reason: the
    // classification depends solely on the cwd's git repo, so it must never
    // reach loadLoreApp/bun:sqlite — which also means it can never touch the
    // repo's own .lore/. Thin adapter: the ambient reads and the git port are
    // assembled here, every decision lives in service/binary-provenance.ts.
    if (args["check-binary-provenance"] === true) {
      const embedded = readEmbeddedBuildProvenance();
      const verdict = classifyBinaryProvenance(
        gatherBinaryProvenanceFacts({
          embedded,
          is_compiled: isCompiledBinary(Bun.main),
          cwd: process.cwd(),
          probe: createRealGitProvenanceProbe(),
        }),
      );
      const rendered = renderBinaryProvenanceVerdict(verdict);

      if (args.json) {
        // `summary` is carried into the payload so a --json consumer reads the
        // SAME tokens (`skipped`, both shas) a stdout reader does — one
        // rendering, two surfaces, never a second phrasing that can drift.
        console.log(
          JSON.stringify(
            { ok: true, data: { binary_provenance_check: { ...verdict, summary: rendered.summary } } },
            null,
            2,
          ),
        );
      } else {
        for (const line of rendered.lines) console.log(line);
      }

      process.exitCode = BINARY_PROVENANCE_EXIT_CODES[verdict.kind];
      return;
    }

    // reason: AC-FR-5 (task-raise-the-evidence-tail-guard-s-predicate-to-its-
    // own) — dispatched BEFORE every other flag: enumeration is a read-only,
    // standalone query over the same COUNT_FIELD_ENUMERATORS registry the
    // normal-status branch consumes below, never composed with --check-*.
    if (typeof args.enumerate === "string") {
      const { app, dbPath } = loadLoreApp();
      try {
        const enumerator = COUNT_FIELD_ENUMERATORS[args.enumerate];
        if (enumerator === undefined) {
          const knownFields = Object.keys(COUNT_FIELD_ENUMERATORS).sort().join(", ");
          const error: LoreError = {
            code: "VALIDATION_ERROR",
            field: "enumerate",
            message: `no enumerator registered for count field "${args.enumerate}" — known fields: ${knownFields}`,
            value: args.enumerate,
          };
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }
        const membersResult = await enumerator(app, dbPath);
        if (!membersResult.ok) {
          process.stderr.write(formatError(membersResult.error) + "\n");
          process.exitCode = exitCode(membersResult.error);
          return;
        }
        const members = membersResult.value;
        if (args.json) {
          console.log(
            JSON.stringify(
              { ok: true, data: { field: args.enumerate, count: members.length, members } },
              null,
              2,
            ),
          );
        } else {
          console.log(`${args.enumerate}: ${members.length} member(s)`);
          for (const member of members) console.log(`  - ${member}`);
        }
        process.exitCode = 0;
        return;
      } finally {
        app.close();
      }
    }

    const checkTreeRequested = args["check-tree"] === true;
    const checkDriftRequested = args["check-drift"] === true;
    const checkRequirementsRequested = args["check-requirements"] === true;
    const checkPrdBudgetRequested = args["check-prd-budget"] === true;
    const checkIssuesRequested = args["check-issues"] === true;
    const checkClaudeMdRequested = args["check-claude-md"] === true;
    const checkMemoryPointersRequested = args["check-memory-pointers"] === true;
    const checkBaselineRequested = args["check-baseline"] === true;

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
      const budgetResolution = resolveClaudeMdBudgets(process.cwd());
      const budgets = budgetResolution.budgets;
      // reason: emitted BEFORE any measurement is printed, so an operator
      // reading the numbers below already knows whose ceilings they are. On
      // stderr (never stdout) so it cannot corrupt the --json payload, which
      // carries the same fact in `budget_source`/`budget_substitution` for
      // consumers that never see stderr.
      const substitutionNotice = formatMemoryFileBudgetSubstitution(budgetResolution, process.cwd());
      if (substitutionNotice !== undefined) process.stderr.write(substitutionNotice + "\n");

      const files = discoverMemoryFiles(process.cwd(), budgets.filenames);
      // reason: runMemoryFileChecks (service/claude-md-admission.ts) is the
      // SOLE composition entry both this branch and flows/context-flow.ts
      // route through (AC-COMPOSE-1) — neither calls an individual metric
      // function directly, and that now includes the headroom-reporting pair
      // (N15: they route THROUGH this entry too, no longer a bypass).
      // `fileExists` resolves candidate paths against THIS process's cwd
      // (the same root `discoverMemoryFiles` walked); `docExists` is
      // hardcoded `() => true` here — every slug "exists" from this
      // branch's point of view, so the slug-pointer metric structurally
      // never fires on `--check-claude-md` (N14: this check must never
      // reach the corpus DB — Module Boundary invariant 2 — a real
      // corpus-backed lookup is `--check-memory-pointers`'s job, below).
      const {
        deterministic: findings,
        advisory,
        headroom,
        warnings,
        adoption,
      } = runMemoryFileChecks(files, budgets, {
        fileExists: (p) => existsSync(join(process.cwd(), p)),
        docExists: () => true,
      });

      const renderInput: CheckClaudeMdRenderInput = {
        findings,
        advisory,
        headroom,
        warnings,
        budgetResolution,
        adoption,
      };

      if (args.json) {
        console.log(JSON.stringify(buildCheckClaudeMdJsonPayload(renderInput), null, 2));
      } else {
        for (const line of formatCheckClaudeMdHuman(renderInput)) console.log(line);
      }

      process.exitCode = findings.length > 0 ? 3 : 0;
      return;
    }

    // ── check-tree / check-drift / check-requirements / check-prd-budget / check-issues / check-memory-pointers branch (D5 restructure + N14) ────
    if (
      checkTreeRequested ||
      checkDriftRequested ||
      checkRequirementsRequested ||
      checkPrdBudgetRequested ||
      checkIssuesRequested ||
      checkMemoryPointersRequested ||
      checkBaselineRequested
    ) {
      const { app, config, dbPath } = loadLoreApp();
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

        // ---- Memory pointers section (Phase 2, N14, spec-claude-md-governance-content-dimension-checks-wire-the) ----
        // reason: mirrors the requirements/prd-budget/issues sections immediately above —
        // this flag joins the corpus-loading family SPECIFICALLY because slug existence
        // requires the corpus (unlike --check-claude-md, which is corpus-free by SPEC-095
        // D9 and hardcodes docExists to always-true). Routes through the SAME sole
        // composition entry that branch uses (AC-COMPOSE-1) — only the injected `docExists`
        // predicate differs.
        let memoryPointersPayload: MemoryPointersPayload | undefined;
        let memoryPointersInconsistent = false;
        if (checkMemoryPointersRequested) {
          const budgets = resolveMemoryFileBudgets(config);
          const files = discoverMemoryFiles(process.cwd(), budgets.filenames);

          const allDocsResult = await app.corpusService.list({});
          if (!allDocsResult.ok) {
            process.stderr.write(formatError(allDocsResult.error) + "\n");
            process.exitCode = exitCode(allDocsResult.error);
            return;
          }
          const knownSlugs = new Set(allDocsResult.value.docs.map((d) => d.slug));

          const {
            deterministic: memoryPointerFindings,
            advisory: memoryPointerAdvisory,
            adoption: memoryPointerAdoption,
          } = runMemoryFileChecks(files, budgets, {
            fileExists: (p) => existsSync(join(process.cwd(), p)),
            docExists: (slug) => knownSlugs.has(slug),
          });
          memoryPointersPayload = {
            checked: files.length,
            consistent: memoryPointerFindings.length === 0,
            findings: memoryPointerFindings,
            adoption_lines: formatAdoptionDowngradeLines(memoryPointerAdvisory, memoryPointerAdoption),
          };
          memoryPointersInconsistent = memoryPointerFindings.length > 0;
        }

        // ---- Baseline integrity section (baseline slice 1 §C7) ----
        // reason: reads through a second, read-only store handle on the same DB because `App` does not
        // expose its store; closed in the `finally` below via `baselineStore`.
        let baselinePayload: { checked: true; consistent: boolean; findings: BaselineFinding[] } | undefined;
        let baselineInconsistent = false;
        if (checkBaselineRequested) {
          const baselineStore = new SQLiteStore(dbPath);
          try {
            const findingsResult = await findBaselineIntegrityFindings(baselineStore);
            if (!findingsResult.ok) {
              process.stderr.write(formatError(findingsResult.error) + "\n");
              process.exitCode = exitCode(findingsResult.error);
              return;
            }
            baselinePayload = { checked: true, consistent: findingsResult.value.length === 0, findings: findingsResult.value };
            baselineInconsistent = findingsResult.value.length > 0;
          } finally {
            baselineStore.close();
          }
        }

        // ---- Exit precedence (D5, pinned; SPEC-055/SPEC-080/issue-closure-loop/N14 fold into the drift tier) ----
        let finalExit: number;
        if (
          treeInconsistent ||
          driftInconsistent ||
          requirementsInconsistent ||
          prdBudgetInconsistent ||
          issuesInconsistent ||
          memoryPointersInconsistent ||
          baselineInconsistent
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
          if (memoryPointersPayload !== undefined) data["memory_pointers"] = memoryPointersPayload;
          if (baselinePayload !== undefined) data["baseline_check"] = baselinePayload;
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
          if (memoryPointersPayload !== undefined) renderMemoryPointersSection(memoryPointersPayload);
          if (baselinePayload !== undefined) {
            if (baselinePayload.consistent) console.log("Baseline: registry, leaves and depends_on are consistent.");
            else {
              console.log(`Baseline: ${baselinePayload.findings.length} integrity finding(s):`);
              for (const f of baselinePayload.findings) console.log(`  - [${f.kind}] ${f.doc}: ${f.detail}`);
            }
          }
        }

        process.exitCode = finalExit;
        return;
      } finally {
        app.close();
      }
    }

    // ── normal status branch ─────────────────────────────────────────────────
    const { app, config, dbPath } = loadLoreApp();
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
      //
      // reason: AC-BFI-4 — the number is the ENUMERATOR's member-list length, the
      // same list `lore status --enumerate code_anchor_specs` prints, never a
      // separately-tallied counter (`collectCodeAnchorSpecMembers` still runs the
      // shared `countArmedSpecs` over that same list and fails loud on a
      // disagreement, so `lore bootstrap`'s independent call cannot drift from
      // this one in silence).
      const codeAnchorSpecMembersResult = await collectCodeAnchorSpecMembers(app);
      if (!codeAnchorSpecMembersResult.ok) {
        process.stderr.write(formatError(codeAnchorSpecMembersResult.error) + "\n");
        process.exitCode = exitCode(codeAnchorSpecMembersResult.error);
        return;
      }
      const codeAnchorSpecs = codeAnchorSpecMembersResult.value.length;

      // SPEC-058 §Scope — discoverability for existing corpora (config-only, no IO).
      const verificationProfileKinds = configuredVerificationProfileKinds(config);

      // spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1 surfacing
      // (AC-FALS-6/10) — corpus-wide pass_unfalsified count + the M3 unclaimed-oracle
      // report. REPORT-ONLY: neither number below may influence process.exitCode —
      // 574/700 existing criteria are grandfathered by the governing spec's WRITTEN
      // exemption, never by a synthesized red run.
      const falsifiabilitySignalsResult = await collectFalsifiabilitySignals(app);
      if (!falsifiabilitySignalsResult.ok) {
        process.stderr.write(formatError(falsifiabilitySignalsResult.error) + "\n");
        process.exitCode = exitCode(falsifiabilitySignalsResult.error);
        return;
      }
      // reason: AC-FR-5 — the count is DERIVED from the member list's length,
      // never a separately-tallied counter (see collectFalsifiabilitySignals's
      // own JSDoc and the COUNT_FIELD_ENUMERATORS registry above).
      const { passUnfalsifiedMembers, declaredScriptCommands } = falsifiabilitySignalsResult.value;
      const passUnfalsifiedCount = passUnfalsifiedMembers.length;
      const unclaimedOracle = await runUnclaimedOracleCheck(declaredScriptCommands);

      // spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §D8,
      // task-wire-allow-missing-path-and-the-unredeemed-declaration (AC-OX-10) —
      // corpus-wide count of D8 `--allow-missing-path` escape declarations whose
      // declared path is STILL absent from disk. REPORT-ONLY, same discipline as
      // `pass_unfalsified_count`/`unclaimed_oracle` above: never influences
      // `process.exitCode` — a dangling declaration is a promise to redeem, not a
      // corpus-integrity breach the CI gate should block on.
      const unredeemedResult = await listUnredeemedAllowMissingPathDeclarations(app, dbPath);
      if (!unredeemedResult.ok) {
        process.stderr.write(formatError(unredeemedResult.error) + "\n");
        process.exitCode = exitCode(unredeemedResult.error);
        return;
      }
      // reason: AC-FR-5 — same derive-from-member-list discipline as
      // passUnfalsifiedCount immediately above.
      const unredeemedAllowMissingPathCount = unredeemedResult.value.length;

      // task-raise-the-evidence-tail-guard-s-predicate-to-its-own (AC-FR-5,
      // G4) — corpus-wide runner-vs-self-report evidence distribution.
      // REPORT-ONLY, same discipline as every other count on this branch:
      // never influences process.exitCode. Both counts derive from
      // collectCaptureSourceMembers's member lists' lengths.
      const captureSourceMembersResult = await collectCaptureSourceMembers(app);
      if (!captureSourceMembersResult.ok) {
        process.stderr.write(formatError(captureSourceMembersResult.error) + "\n");
        process.exitCode = exitCode(captureSourceMembersResult.error);
        return;
      }
      const captureSourceRunnerCount = captureSourceMembersResult.value.runner.length;
      const captureSourceSelfReportCount = captureSourceMembersResult.value.selfReport.length;

      // spec-the-defect-channel-cannot-be-honestly-maintained-an §M7, AC-DC-16
      // — corpus-wide count of DANGLING `adopted` claims (owner archived/
      // deprecated without the defect ever being fixed). REPORT-ONLY, same
      // discipline as every other count on this branch. The count is this
      // list's `.length`, never a separately-tallied counter (AC-FR-5).
      const adoptedAbandonedMembersResult = await collectAdoptedAbandonedMembers(app);
      if (!adoptedAbandonedMembersResult.ok) {
        process.stderr.write(formatError(adoptedAbandonedMembersResult.error) + "\n");
        process.exitCode = exitCode(adoptedAbandonedMembersResult.error);
        return;
      }
      const adoptedAbandonedCount = adoptedAbandonedMembersResult.value.length;

      // spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor (AC-BFI-1)
      // — WHICH BINARY produced everything above. Ambient-only (no corpus, no
      // git spawn): it reports what this binary CARRIES; comparing that against
      // a repo is `--check-binary-provenance`'s job.
      const embeddedProvenance = readEmbeddedBuildProvenance();

      // baseline slice 1 §C7 — ABSENT (key and line) unless the corpus has a live baseline doc or an
      // AC citation, so a pre-baseline corpus prints exactly what it printed before. Git-free
      // (`counts` mode); the second store handle exists because `App` does not expose its store.
      const baselineStore = new SQLiteStore(dbPath);
      let baselineStatus: BaselineStatus | null;
      try {
        const repoRoot = resolveGitRoot(process.cwd());
        const baselineResult = await computeBaselineStatus(
          baselineStore,
          new RuleStateService(baselineStore, new SpawnGitPort(repoRoot)),
          (path) => existsSync(join(repoRoot, path)),
        );
        if (!baselineResult.ok) {
          process.stderr.write(formatError(baselineResult.error) + "\n");
          process.exitCode = exitCode(baselineResult.error);
          return;
        }
        baselineStatus = baselineResult.value;
      } finally {
        baselineStore.close();
      }

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
                pass_unfalsified_count: passUnfalsifiedCount,
                unclaimed_oracle: unclaimedOracle,
                unredeemed_allow_missing_path_count: unredeemedAllowMissingPathCount,
                capture_source_runner_count: captureSourceRunnerCount,
                capture_source_self_report_count: captureSourceSelfReportCount,
                adopted_abandoned_count: adoptedAbandonedCount,
                // ALWAYS present, `null` included (same convention as
                // `invalid_docs`) — an omitted key would let a consumer read
                // "absent" as "this binary is fine".
                binary_provenance: provenanceOrNull(embeddedProvenance),
                ...(baselineStatus !== null ? { baseline: baselineStatus } : {}),
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

      // spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1
      // surfacing (AC-FALS-6) — printed UNCONDITIONALLY (including 0), same
      // "never a silent count" discipline as `Retracted:` above: this is the
      // corpus's own baseline falsifiability metric, not a per-run advisory.
      // REPORT-ONLY — never affects exit code (see the computation site's comment).
      console.log(
        `Pass-unfalsified criteria: ${passUnfalsifiedCount} (green, never observed able to fail — ` +
          "report-only, see spec-oracle-tier-falsifiability-a-criterion-never-observed-red)",
      );

      // spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §D8,
      // task-wire-allow-missing-path-and-the-unredeemed-declaration (AC-OX-10) —
      // printed UNCONDITIONALLY (including 0), same "never a silent count"
      // discipline as `Retracted:`/`Pass-unfalsified criteria:` above: a
      // declaration that exercised the D8 escape and never got its file
      // created IS a dangling promise (D8's own "make the ambiguity visible
      // and attributable" resolution), so it must stay visible even at zero.
      // REPORT-ONLY — never affects exit code.
      console.log(
        `Unredeemed allow-missing-path declarations: ${unredeemedAllowMissingPathCount} ` +
          "(a lore ac add/set --allow-missing-path escape whose declared path still does not exist — " +
          "creating the file drops this on the next run, report-only)",
      );

      // task-raise-the-evidence-tail-guard-s-predicate-to-its-own (AC-FR-5, G4)
      // — printed UNCONDITIONALLY (including 0), same "never a silent count"
      // discipline as every other count above. Enumerate either bucket's
      // exact members via `lore status --enumerate capture_source_runner_count`
      // / `--enumerate capture_source_self_report_count`. REPORT-ONLY.
      console.log(
        `Capture source: ${captureSourceRunnerCount} runner-captured / ${captureSourceSelfReportCount} ` +
          "self-reported (across every task/phase evidence entry — report-only, see " +
          "spec-falsifiability-reachability-a-feedable-checkpoint-an §D5)",
      );

      // spec-the-defect-channel-cannot-be-honestly-maintained-an §M7, AC-DC-16
      // — printed UNCONDITIONALLY (including 0), same "never a silent count"
      // discipline as every other count above: abandonment must stay visible
      // even when nothing is dangling, or the count itself becomes the kind of
      // silent gap §M7 exists to close. Enumerate exact members via
      // `lore status --enumerate adopted_abandoned_count`. REPORT-ONLY.
      console.log(
        `Adopted-and-abandoned reports: ${adoptedAbandonedCount} ` +
          "('adopted' claims whose owner plan/task reached archived/deprecated with the report still carrying " +
          "no terminal resolution — report-only, see spec-the-defect-channel-cannot-be-honestly-maintained-an §M7)",
      );

      // spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor (AC-BFI-1)
      // — printed UNCONDITIONALLY, including the "none embedded" case, same
      // "never a silent count" discipline as `Retracted:` above: not knowing
      // which binary issued this report is itself the fact worth printing.
      console.log(formatBinaryProvenanceStatusLine(embeddedProvenance));

      // baseline slice 1 §C7 — one line, only when a warning count is non-zero (report-only).
      if (baselineStatus !== null && baselineWarningCount(baselineStatus) > 0) {
        console.log(
          `\nBaseline warnings: ${baselineStatus.cites_dangling} dangling cites, ${baselineStatus.cites_to_inactive} cites to inactive rules, ` +
            `${baselineStatus.ambiguous_ac_ref} ambiguous evidence refs, ${baselineStatus.registry_mismatch} registry mismatches, ` +
            `${baselineStatus.index_mismatch} index mismatches, ` +
            `${baselineStatus.rules_with_impl_detail} rules with implementation detail (run \`lore status --check-baseline\` / \`lore baseline tree --states\`)`,
        );
      }

      // baseline slice 2 §C4 — exemptions on this branch's corpus, only when any exist (report-only).
      if (baselineStatus !== null && baselineStatus.exemptions_active + baselineStatus.exemptions_expired > 0) {
        console.log(
          `\nExemptions: ${baselineStatus.exemptions_active} active, ${baselineStatus.exemptions_expired} expired ` +
            `(${(baselineStatus.exemption_ratio * 100).toFixed(1)}% of live criteria, cap 10%)`,
        );
      }

      // M3 (AC-FALS-10) — same "only when > 0" discipline as open_stale_candidates/
      // codeAnchorSpecs above; silent when unavailable (no companion source
      // checkout, e.g. an external `lore` install) or when the scan found nothing.
      if (unclaimedOracle.available && unclaimedOracle.findings.length > 0) {
        console.log(
          `\nUnclaimed oracle values: ${unclaimedOracle.findings.length} (a test-name filter value ` +
            "present in a test file, bound by NO declared AC — run `bun scripts/check-unclaimed-oracle.ts` for detail)",
        );
      }

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
