/**
 * lore status — repository and corpus statistics and health check.
 * With --check-tree: validate corpus against lore.tree.yaml blueprint.
 * With --check-tree --fix: auto-fix orphan/misplaced drift.
 * With --check-drift: verify spec-declared code_anchors against the working tree
 *   (SPEC-045 §Design Decisions D5) — deterministic, zero LLM calls.
 * With --check-issues: flag stale open reports (computed `open` and older than
 *   `feedback.stale_after_days`) — deterministic, report-only, mutates nothing
 *   (spec-issue-closure-loop-computed-resolution-agent-reachable §D5). A report whose
 *   computed resolution is `fixed` is NOT flagged: archiving the fix closes its GitHub
 *   issue, so the computed resolution plus the closed issue are the record
 *   (spec-archiving-the-work-that-resolves-a-defect-report-closes D6).
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
 * With --check-fragments: run the SAME fragments check as `lore fragments check`
 *   (`commands/fragments.ts::runCheck` — the one renderer and exit mapping)
 *   and exit 4 when any finding is present, 0 when clean (spec-rule-store-git-tracked-fragment-
 *   selection-on-demand-skill Scope 7, AC-RS-9, BR-1066). Exit 4 is the SAME number
 *   `lore fragments check` uses (the VALIDATION_ERROR family), NOT the 3 of the other --check-*
 *   flags: a fragments finding is a validation failure of the rule store, and sharing the code
 *   means `lore status --check-fragments` and `lore fragments check` agree on the exit number.
 *   Standalone, corpus-free: see the dispatch note below.
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
 *   --check-fragments → the app-backed --check-* family → the plain run.
 * The first four are mutually exclusive by design (each returns), so combining
 * them runs only the highest; the app-backed family composes internally as
 * documented above. --check-fragments sits directly below --check-claude-md for
 * the same Module-Boundary reason: it reads config YAML and fragment files only
 * (`lore fragments` is a bootstrap-stage command that must never reach
 * `loadLoreApp`/`bun:sqlite`), so it cannot join the app-backed fold and runs
 * alone when combined with those flags. This precedence is asserted by
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
import { runCheck as runFragmentsCheckCommand } from "./fragments.js";
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
  outlineBudgetSchema,
  resolveBaselineNodeBudgets,
} from "@lore/core";
import type {
  CallerSurface,
  LoreConfig,
  LoreError,
  MemoryFileBudgetResolution,
  OutlineBudget,
  Result,
} from "@lore/core";
import {
  checkPrdBudget,
  type PrdBudgetBreach,
  type PrdBudgetLike,
} from "../../../service/prd-budget-check.js";
import {
  checkBaselineNodeBudget,
  type BaselineNodeBreach,
} from "../../../service/baseline-node-budget.js";
import { computeSpecCitationCensus, type SpecCitationCensus } from "../../../service/spec-citation-census.js";
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
} from "../../../service/issue-resolution.js";
import { computeIssueCheck, type IssueCheckPayload } from "../status-issue-check.js";
// reason: loadConfig reads `.lore/config.yaml` via plain Node fs — only
// reachable via the `@lore/core/node` subpath (browser-safety split,
// packages/core/src/CLAUDE.md). NOT a bun:sqlite dependency, so it's safe to
// call from the --check-claude-md branch below, which per the spec's Module
// Boundary invariant 2 must NEVER reach loadLoreApp/bun:sqlite — mirrors
// setup-check.ts's identical precedent for this exact import.
import { loadConfig } from "@lore/core/node";
import { resolveCiteGateRaw, classifyCaptureSource, type DocRecord } from "@lore/core";
import type { StampVerdictDistribution } from "../../../service/gate-predicates.js";
import { formatStampVerdictLine } from "../assess-render.js";
import type { EvidenceEntry } from "@lore/core";
import {
  findUnresolvedStateBindingSkips,
  renderStateBindingSkipLine,
  STATE_BINDING_SKIP_AUDIT_ACTION,
  type UnresolvedStateBindingSkip,
} from "../../../service/state-binding-skip.js";
import { resolveCiteGateFor } from "../../../service/ac-write-chokepoint.js";
import { BASELINE_ADOPT_AUDIT_ACTION } from "./baseline-adopt.js";
import { decideAcCiteStatus, ENFORCE_REFUSES_NOTHING_WARNING, lastAdoptedModeOf } from "../../../service/ac-cite-status.js";
import { AttributionReport, type AttributionShare, type IdentitySourceCounts, type OrphanedDirtySummary } from "../../../service/attribution-report.js";
import type { AcCiteStatus } from "../../../service/ac-cite-status.js";
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
/** BR-1039 — the stated period of the attribution share, in days ending now. */
const ATTRIBUTION_WINDOW_DAYS = 14;

const ALL_SURFACES:ReadonlyArray<CallerSurface> = [
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
/**
 * SPEC-143 AC-CT-8 — the state-binding skips still waiting for a stamped re-record: every
 * `state_binding_skipped` audit row, minus those a later stamped runner row for the same task + AC
 * has superseded. Reads only (audit query + `corpusService.get`); a failed read is returned, never
 * flattened to "no skips".
 */
async function collectStateBindingSkips(
  app: ReturnType<typeof loadLoreApp>["app"],
): Promise<Result<UnresolvedStateBindingSkip[], LoreError>> {
  const rows = await app.auditService.query({ action: STATE_BINDING_SKIP_AUDIT_ACTION, limit: 500 });
  if (!rows.ok) return rows;
  const evidenceByTask = new Map<string, EvidenceEntry[]>();
  for (const taskId of new Set(rows.value.flatMap((r) => (r.doc_id === undefined ? [] : [r.doc_id])))) {
    const task = await app.corpusService.get(taskId);
    if (!task.ok) return task;
    evidenceByTask.set(taskId, extractEvidence(task.value.doc));
  }
  return { ok: true, value: findUnresolvedStateBindingSkips(rows.value, (id) => evidenceByTask.get(id) ?? []) };
}

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
 * onto `prd-budget-check.ts`'s own pure-fn input shape (`PrdBudgetLike`,
 * field name `whole_doc_chars`) — the two modules deliberately do not share
 * field names (see `prd-budget-check.ts`'s module header), so this adapter is
 * the ONE place the mapping happens. The per-tier `core_max_chars` /
 * `domain_max_chars` fields are retired history (Baseline slice 3b, D7) and
 * are not read.
 *
 * @param core - A Zod-validated `prd.extra.outline_budget`, or `undefined`
 *   when the PRD declares none (checkPrdBudget then falls back to the
 *   stated defaults for every field).
 * @returns The equivalent `Partial<PrdBudgetLike>`, or `undefined`.
 */
function toPrdBudgetLike(core: OutlineBudget | undefined): Partial<PrdBudgetLike> | undefined {
  if (core === undefined) return undefined;
  return {
    whole_doc_chars: core.whole_body_max_chars,
    extra_prose_chars: core.extra_prose_chars,
  };
}

/** Text rendering for one PRD's budget breaches — used by `renderPrdBudgetSection`. */
function renderPrdBudgetBreach(prdSlug: string, breach: PrdBudgetBreach): void {
  console.log(`  - ${prdSlug} [${breach.kind}]: ${breach.detail}`);
}

/** The `data.baseline_budget` payload of `--check-prd-budget` (Baseline slice 3b, AC-BLS3B-8). */
interface BaselineBudgetPayload {
  checked: number;
  consistent: boolean;
  nodes: BaselineNodeBreach[];
}

/** Text rendering for the per-kind baseline node budget section; one line per finding naming node, kind, measured and cap. */
function renderBaselineBudgetSection(payload: BaselineBudgetPayload): void {
  if (payload.consistent) {
    console.log(`Baseline node budget: within budget (${payload.checked} node(s) checked).`);
    return;
  }
  console.log(`Baseline node budget: BREACHED (${payload.checked} node(s) checked):`);
  for (const n of payload.nodes) {
    const unit = n.metric === "chars" ? "chars" : "rules";
    console.log(`  - ${n.slug} [${n.kind}]: ${n.measured} ${unit}, exceeding the ${n.kind} cap of ${n.cap} ${unit}`);
  }
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

// ── `--check-issues` detector — `computeIssueCheck` lives in `../status-issue-check.ts` (vitest-safe sibling) ──

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
  const total = payload.stale_open.length;
  console.log(`Issue closure: ${total} issue(s) flagged (${payload.checked} checked):`);
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
): Promise<Result<{ runner: string[]; selfReport: string[]; runnerUnattested: string[] }, LoreError>> {
  const runner: string[] = [];
  const selfReport: string[] = [];
  const runnerUnattested: string[] = [];

  for (const type of ["task", "phase"] as const) {
    const listResult = await app.corpusService.listFull({ type });
    if (!listResult.ok) return listResult;

    for (const doc of listResult.value.docs) {
      const entries = extractEvidence(doc);
      entries.forEach((entry, index) => {
        const member = `${doc.slug}#${index}`;
        const bucket = classifyCaptureSource(entry.capture_source);
        switch (bucket) {
          case "runner":
            runner.push(member);
            break;
          case "self-report":
            selfReport.push(member);
            break;
          case "runner-unattested":
            runnerUnattested.push(member);
            break;
          default: {
            const unreachable: never = bucket;
            throw new Error(`unhandled capture_source bucket: ${String(unreachable)}`);
          }
        }
      });
    }
  }

  return ok({ runner, selfReport, runnerUnattested });
}

/**
 * Corpus-wide stamp-verdict distribution (SPEC-143 AC-CT-9(d)) over every task AND phase doc — the SECOND
 * axis over the same evidence rows `collectCaptureSourceMembers` buckets, reported alongside it and never
 * merged. The five buckets come from the ONE exported predicate (`computeStampVerdictDistribution`, through
 * `CorpusService.stampVerdictDistribution`) that `lore assess` also renders; this adapter derives nothing.
 */
async function collectStampVerdictDistribution(
  app: ReturnType<typeof loadLoreApp>["app"],
): Promise<Result<StampVerdictDistribution, LoreError>> {
  const docs: DocRecord[] = [];
  for (const type of ["task", "phase"] as const) {
    const listResult = await app.corpusService.listFull({ type });
    if (!listResult.ok) return listResult;
    docs.push(...listResult.value.docs);
  }
  return app.corpusService.stampVerdictDistribution(docs);
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
  capture_source_runner_unattested_count: async (app) => {
    const membersResult = await collectCaptureSourceMembers(app);
    if (!membersResult.ok) return membersResult;
    return ok(membersResult.value.runnerUnattested);
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
        "Verify every PRD requirement is covered by an AC of some spec (SPEC-055; specs take no parent, every spec counts). Uncovered P0 → exit 3. Composes with --check-tree/--check-drift.",
    },
    "check-prd-budget": {
      type: "boolean",
      description:
        "Verify every PRD's rendered body/outline-entry/extra-prose char budgets (SPEC-080 C3). Breach → exit 3. Composes with --check-tree/--check-drift/--check-requirements.",
    },
    "check-issues": {
      type: "boolean",
      description:
        "Flag stale open reports (older than feedback.stale_after_days). Report-only, mutates nothing. Breach → exit 3. Composes with --check-tree/--check-drift/--check-requirements/--check-prd-budget.",
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
    "check-fragments": {
      type: "boolean",
      description:
        "Run the same context-fragments check as `lore fragments check` (caps, duplicate lines, selection, skill collisions, rules/skills drift, language drift). Any finding → exit 4, clean → 0. Config/files only, never loads the corpus DB. Standalone — runs alone when combined with the app-backed --check-* flags.",
    },
    "check-binary-provenance": {
      type: "boolean",
      description:
        "Compare THIS binary's embedded build commit against the cwd repo. dev-synced → 0; dev-stale (built from another commit of this repo) → 3, naming both shas; not a dev checkout (build commit unknown here, e.g. an installed lore) → 0, 'skipped'. Git-only, never loads the corpus DB. Standalone — takes precedence over every other flag.",
    },
    enumerate: {
      type: "string",
      description:
        "Enumerate the MEMBERS behind a count field the plain run reports (e.g. pass_unfalsified_count, unredeemed_allow_missing_path_count, capture_source_runner_count, capture_source_self_report_count, capture_source_runner_unattested_count, code_anchor_specs, adopted_abandoned_count). Unknown field → exit 4, naming it and the known set.",
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

    // ── check-fragments branch (spec-rule-store-git-tracked-fragment-selection-on-demand-skill, AC-RS-9) ──
    // reason: corpus-free like --check-claude-md — `buildFragmentsFlowDeps` reads config YAML and
    // fragment files only, so this MUST return before `loadLoreApp`. The deps builder and the
    // check are the ones `lore fragments check` uses, so the two commands cannot disagree on a
    // finding; only the stdout/stderr rendering below is repeated (it is module-private there).
    if (args["check-fragments"] === true) {
      await runFragmentsCheckCommand(args, process.cwd(), "lore status --check-fragments");
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
          | { checked: number; consistent: boolean; prds: Array<{ slug: string; total: number; uncovered: string[]; uncovered_p0: string[]; migrated: string[]; unmigrated: string[] }> }
          | undefined;
        let requirementsInconsistent = false;
        if (checkRequirementsRequested) {
          const prdsResult = await app.corpusService.list({ type: "prd" });
          if (!prdsResult.ok) {
            process.stderr.write(formatError(prdsResult.error) + "\n");
            process.exitCode = exitCode(prdsResult.error);
            return;
          }
          const prds: Array<{ slug: string; total: number; uncovered: string[]; uncovered_p0: string[]; migrated: string[]; unmigrated: string[] }> = [];
          for (const prd of prdsResult.value.docs) {
            const covResult = await app.corpusService.computeRequirementCoverageForPrd(prd.id);
            if (!covResult.ok) {
              process.stderr.write(formatError(covResult.error) + "\n");
              process.exitCode = exitCode(covResult.error);
              return;
            }
            const cov = covResult.value;
            prds.push({ slug: prd.slug, total: cov.total, uncovered: cov.uncovered, uncovered_p0: cov.uncovered_p0, migrated: cov.migrated, unmigrated: cov.unmigrated });
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
        // every PRD in the corpus, zero-LLM, zero fs probing. The check module itself
        // never touches the store. The outline tier / detail-link checks are retired
        // (Baseline slice 3b, D7); the per-kind baseline node budget below replaces them.
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

            const budgetParse = outlineBudgetSchema.safeParse(doc.extra["outline_budget"]);
            const budget = budgetParse.success ? toPrdBudgetLike(budgetParse.data) : undefined;

            const checkResult = checkPrdBudget({
              raw_body: doc.content,
              extra: doc.extra,
              budget,
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

        // ---- Baseline node budget section (Baseline slice 3b, AC-BLS3B-8) ----
        // reason: rides the same flag as the PRD budget (one size gate, one exit-3). Reads through a second
        // store handle (like the baseline integrity section below) instead of `corpusService.get` per node:
        // a `get` records a read trace row, and the corpus holds hundreds of baseline nodes.
        let baselineBudgetPayload: BaselineBudgetPayload | undefined;
        let baselineBudgetInconsistent = false;
        if (checkPrdBudgetRequested) {
          const budgets = resolveBaselineNodeBudgets(config);
          const budgetStore = new SQLiteStore(dbPath);
          try {
            const nodesResult = await budgetStore.findMany({ type: "baseline" });
            if (!nodesResult.ok) {
              process.stderr.write(formatError(nodesResult.error) + "\n");
              process.exitCode = exitCode(nodesResult.error);
              return;
            }
            const nodes = nodesResult.value.flatMap((doc) => checkBaselineNodeBudget(doc, budgets));
            baselineBudgetInconsistent = nodes.length > 0;
            baselineBudgetPayload = { checked: nodesResult.value.length, consistent: nodes.length === 0, nodes };
          } finally {
            budgetStore.close();
          }
        }

        // ---- Issues section (D5, spec-issue-closure-loop-computed-resolution-agent-reachable) ----
        // reason: mirrors the requirements/prd-budget sections immediately above — store-only
        // (plus one corpusService.get per issue task, same N-loop shape those two sections already
        // use), zero-LLM, zero fs probing, REPORT-ONLY (see computeIssueCheck's own header).
        let issuesPayload: IssueCheckPayload | undefined;
        let issuesInconsistent = false;
        if (checkIssuesRequested) {
          const staleAfterDays = resolveStaleAfterDays(config);
          const issuesResult = await computeIssueCheck(app.corpusService, staleAfterDays);
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
          baselineBudgetInconsistent ||
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
          if (requirementsPayload !== undefined) {
            data["requirement_coverage"] = requirementsPayload;
            // reason: task-red-c's contract (C5) reads the same payload at `data.requirements`;
            // the established `requirement_coverage` key is kept so existing consumers do not break.
            data["requirements"] = requirementsPayload;
          }
          if (prdBudgetPayload !== undefined) data["prd_budget"] = prdBudgetPayload;
          if (baselineBudgetPayload !== undefined) data["baseline_budget"] = baselineBudgetPayload;
          if (issuesPayload !== undefined) data["issues"] = issuesPayload;
          if (memoryPointersPayload !== undefined) data["memory_pointers"] = memoryPointersPayload;
          if (baselinePayload !== undefined) data["baseline_check"] = baselinePayload;
          console.log(JSON.stringify({ ok: true, data }, null, 2));
        } else {
          for (const line of treeRenderLines) console.log(line);
          if (driftPayload !== undefined) renderDriftSection(driftPayload);
          if (requirementsPayload !== undefined) {
            for (const prd of requirementsPayload.prds) {
              if (prd.migrated.length > 0) {
                console.log(`  ${prd.slug}: migrated [${prd.migrated.join(", ")}] (covered by citations); unmigrated [${prd.unmigrated.join(", ")}]`);
              }
            }
            if (requirementsPayload.consistent) {
              console.log(`Requirement coverage: all P0 requirements covered (${requirementsPayload.checked} PRD(s) checked).`);
            } else {
              console.log(`Requirement coverage: UNCOVERED P0 requirements (${requirementsPayload.checked} PRD(s) checked):`);
              for (const prd of requirementsPayload.prds) {
                if (prd.uncovered_p0.length > 0) {
                  console.log(`  - ${prd.slug}: ${prd.uncovered_p0.join(", ")} (fix: unmigrated -> add a spec AC with --covers <R-id>; migrated -> add a script AC with --cite <BR-n>)`);
                }
              }
            }
          }
          if (prdBudgetPayload !== undefined) renderPrdBudgetSection(prdBudgetPayload);
          if (baselineBudgetPayload !== undefined) renderBaselineBudgetSection(baselineBudgetPayload);
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

      // SPEC-143 AC-CT-8 — state-binding checks `lore verify` SKIPPED because a peer held the oracle lock.
      const stateBindingSkipsResult = await collectStateBindingSkips(app);
      if (!stateBindingSkipsResult.ok) {
        process.stderr.write(formatError(stateBindingSkipsResult.error) + "\n");
        process.exitCode = exitCode(stateBindingSkipsResult.error);
        return;
      }
      const stateBindingSkips = stateBindingSkipsResult.value;

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
      // reason: SPEC-143 AC-CT-9(d) — report-only, alongside (never merged into) the capture_source counts.
      const stampVerdictResult = await collectStampVerdictDistribution(app);
      if (!stampVerdictResult.ok) {
        process.stderr.write(formatError(stampVerdictResult.error) + "\n");
        process.exitCode = exitCode(stampVerdictResult.error);
        return;
      }
      const stampVerdicts = stampVerdictResult.value;
      const captureSourceRunnerCount = captureSourceMembersResult.value.runner.length;
      const captureSourceSelfReportCount = captureSourceMembersResult.value.selfReport.length;
      const captureSourceRunnerUnattestedCount = captureSourceMembersResult.value.runnerUnattested.length;

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
      // AC-BLS2-11: `ac_cite` is emitted only with baseline docs or a stored gate mode (a corpus with
      // neither prints exactly what slice 1 printed), so it stays null when neither holds.
      let acCiteStatus: AcCiteStatus | null = null;
      let attributionShare: AttributionShare;
      let identitySources: IdentitySourceCounts;
      let orphanedDirty: OrphanedDirtySummary;
      let specCitationCensus: SpecCitationCensus | null = null;
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

        // baseline slice 3b BR-1011 (AC-BLS3B-3) — the spec citation census, emitted only when the corpus has baseline
        // docs (AC-BLS2-11: a corpus without them prints exactly what it printed before).
        // BR-1039 — claims, evidence and handoffs of the last ATTRIBUTION_WINDOW_DAYS days and how many carry an attested run.
        const shareResult = await new AttributionReport(baselineStore).share(ATTRIBUTION_WINDOW_DAYS, () => new Date());
        if (!shareResult.ok) {
          process.stderr.write(formatError(shareResult.error) + "\n");
          process.exitCode = exitCode(shareResult.error);
          return;
        }
        attributionShare = shareResult.value;

        // Scope 8 — writes in the window per identity source, and the claims `lore run end` kept for dirty worktrees.
        const attributionReport = new AttributionReport(baselineStore);
        const sourcesResult = await attributionReport.identitySources(ATTRIBUTION_WINDOW_DAYS, () => new Date());
        if (!sourcesResult.ok) {
          process.stderr.write(formatError(sourcesResult.error) + "\n");
          process.exitCode = exitCode(sourcesResult.error);
          return;
        }
        identitySources = sourcesResult.value;
        const orphanedResult = await attributionReport.orphanedDirty(() => new Date());
        if (!orphanedResult.ok) {
          process.stderr.write(formatError(orphanedResult.error) + "\n");
          process.exitCode = exitCode(orphanedResult.error);
          return;
        }
        orphanedDirty = orphanedResult.value;

        const censusBaseline = await baselineStore.findMany({ type: "baseline" });
        if (!censusBaseline.ok) {
          process.stderr.write(formatError(censusBaseline.error) + "\n");
          process.exitCode = exitCode(censusBaseline.error);
          return;
        }
        if (censusBaseline.value.length > 0) {
          const censusSpecs = await baselineStore.findMany({ type: "spec" });
          if (!censusSpecs.ok) {
            process.stderr.write(formatError(censusSpecs.error) + "\n");
            process.exitCode = exitCode(censusSpecs.error);
            return;
          }
          specCitationCensus = computeSpecCitationCensus(censusSpecs.value, censusBaseline.value);
        }

        // baseline slice 3a BL-8 (AC-BLS3-8) — the gate's mode and whether `lore baseline adopt` produced it.
        const rawGate = resolveCiteGateRaw(config);
        const effective = await resolveCiteGateFor(baselineStore, rawGate);
        if (!effective.ok) {
          process.stderr.write(formatError(effective.error) + "\n");
          process.exitCode = exitCode(effective.error);
          return;
        }
        const adoptRows = await app.auditService.query({ action: BASELINE_ADOPT_AUDIT_ACTION, limit: 1 });
        if (!adoptRows.ok) {
          process.stderr.write(formatError(adoptRows.error) + "\n");
          process.exitCode = exitCode(adoptRows.error);
          return;
        }
        const storedMode = typeof rawGate?.mode === "string" ? rawGate.mode : null;
        if (baselineStatus !== null || storedMode !== null) {
          acCiteStatus = decideAcCiteStatus({
            storedMode,
            effectiveMode: effective.value.mode,
            lastAdoptedMode: lastAdoptedModeOf(adoptRows.value[0]),
            armedBranches: effective.value.armed_branches,
          });
        }
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
                capture_source_runner_unattested_count: captureSourceRunnerUnattestedCount,
                stamp_verdicts: stampVerdicts,
                adopted_abandoned_count: adoptedAbandonedCount,
                // ALWAYS present, `null` included (same convention as
                // `invalid_docs`) — an omitted key would let a consumer read
                // "absent" as "this binary is fine".
                binary_provenance: provenanceOrNull(embeddedProvenance),
                harness_run_attribution: attributionShare,
                identity_sources: identitySources,
                orphaned_dirty: orphanedDirty,
                ...(stateBindingSkips.length > 0 ? { state_binding_skips: stateBindingSkips } : {}),
                ...(baselineStatus !== null ? { baseline: baselineStatus } : {}),
                ...(acCiteStatus !== null ? { ac_cite: acCiteStatus } : {}),
                ...(specCitationCensus !== null ? specCitationCensus : {}),
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
          `self-reported / ${captureSourceRunnerUnattestedCount} runner-unattested (across every task/phase evidence entry — report-only, see ` +
          "spec-falsifiability-reachability-a-feedable-checkpoint-an §D5)",
      );

      // SPEC-143 AC-CT-9(d) — the stamp-verdict axis, printed UNCONDITIONALLY beside the capture_source line.
      console.log(`${formatStampVerdictLine(stampVerdicts)} (report-only, never merged into the capture_source buckets)`);

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

      // BR-1039 — printed UNCONDITIONALLY (including 0 of 0), same "never a silent count" discipline as above.
      console.log(
        `Attribution (last ${attributionShare.window_days} days): ${attributionShare.attested} of ${attributionShare.total} ` +
          `claims/evidence/handoffs carry an attested run (share ${attributionShare.share})`,
      );
      console.log(
        `Identity sources (last ${identitySources.window_days} days): run ${identitySources.run}, session ${identitySources.session}, ` +
          `worktree ${identitySources.worktree}, os ${identitySources.os}, other ${identitySources.other}`,
      );
      console.log(
        `Orphaned-dirty claims: ${orphanedDirty.count}` +
          (orphanedDirty.oldest_age_minutes === null ? "" : ` (oldest ${orphanedDirty.oldest_age_minutes} min)`),
      );

      // BR-670 / AC-FIP-4 — rule totals over BOTH trees, one line, only when the baseline block exists
      // (a corpus without baseline docs prints byte-identical output). AD debt entries are named apart.
      if (baselineStatus !== null) {
        console.log(
          `\nBaseline rules: ${baselineStatus.rules_total} (BR ${baselineStatus.rules_by_family.BR}, AS ${baselineStatus.rules_by_family.AS}; ` +
            `live ${baselineStatus.rules_by_lifecycle.live}, deprecated ${baselineStatus.rules_by_lifecycle.deprecated}, retired ${baselineStatus.rules_by_lifecycle.retired}); ` +
            `${baselineStatus.debt_entries} AD debt entries not counted`,
        );
      }

      // baseline slice 1 §C7 — one line, only when a warning count is non-zero (report-only).
      if (baselineStatus !== null && baselineWarningCount(baselineStatus) > 0) {
        console.log(
          `\nBaseline warnings: ${baselineStatus.cites_dangling} dangling cites, ${baselineStatus.cites_to_inactive} cites to inactive rules, ` +
            `${baselineStatus.ambiguous_ac_ref} ambiguous evidence refs, ${baselineStatus.registry_mismatch} registry mismatches, ` +
            `${baselineStatus.index_mismatch} index mismatches, ` +
            `${baselineStatus.rules_with_impl_detail} rules with implementation detail (run \`lore status --check-baseline\` / \`lore baseline tree --states\`)`,
        );
      }

      // baseline slice 3b BR-1011 — both census counts, printed even at 0 (a count that vanishes at 0 reads as "not measured");
      // the whole pair is absent without baseline docs. The slugs live in `--json`.
      if (specCitationCensus !== null) {
        console.log(`\nSpecs without citation: ${specCitationCensus.specs_without_citation.count}`);
        console.log(`Specs with a parent:    ${specCitationCensus.specs_with_parent.count}`);
      }

      // BR-987 (AC-FIP-3) — printed only when true, so a corpus whose gate refuses something prints what it printed before.
      if (acCiteStatus !== null && acCiteStatus.enforce_refuses_nothing) {
        console.log(`\nWarning: ${ENFORCE_REFUSES_NOTHING_WARNING}`);
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

      // SPEC-143 AC-CT-8 — printed only when a skip is unresolved (a corpus with none prints what it printed before).
      const stateBindingSkipLine = renderStateBindingSkipLine(stateBindingSkips);
      if (stateBindingSkipLine !== undefined) console.log(`\n${stateBindingSkipLine}`);

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
