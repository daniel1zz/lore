/**
 * Doc-code drift oracle orchestration flow (SPEC-045 §Design Decisions D5, D7 —
 * memory hygiene part 3). CLI (`lore status --check-drift`, `lore bootstrap`) and
 * MCP (`lore_status {check_drift: true}`, `lore_bootstrap`) both call these
 * functions instead of each re-deriving the `code_drift` JSON shape or the
 * store-only "declared anchor count" line — mirrors `staleness-flow.ts`'s
 * narrow-injected-deps shape (never the full `App`; `App` (`app.ts`)
 * top-level-imports `bun:sqlite` and this module must stay vitest-resolvable —
 * its own coverage lives in `mcp-drift.test.ts`/`spec-projection-anchors.test.ts`,
 * both plain vitest suites, not `.bun.test.ts`).
 *
 * Public surface:
 *   buildDriftFlowDeps(app, driftCheckService) — the ONE adaptation site from a
 *     wired App + its (already-undefined-checked) DriftCheckService into the
 *     narrow DriftFlowDeps bundle used by runDrift.
 *   buildListSpecs(app) — the narrower "list every non-deleted spec" binder alone
 *     — used by countArmedSpecs, which needs NO DriftCheckService at all (a
 *     store-only declared-count read, zero fs probing, D5).
 *   runDrift(deps, probe) — runs checkDrift and shapes the CodeDriftPayload BOTH
 *     CLI --json (`data.code_drift`) and MCP (`lore_status`'s `code_drift`) return.
 *   disabledCodeDriftPayload() — the `workflow.drift.enabled: false` LOUD-skip
 *     payload (D8) — a single derivation site so CLI/MCP never hand-roll the same
 *     literal object twice.
 *   countArmedSpecs(listSpecs) — store-only "N specs declare code_anchors" count,
 *     ZERO fs probing — the shared helper `lore status` (plain) and `lore
 *     bootstrap` both splice in (D5, D7 review U8).
 *   sortDrifts(drifts) — deterministic (doc_slug, then anchor) ordering (D5).
 *   renderDriftRepairHint(row) — the literal `fix: lore anchor rm <spec-slug>
 *     '<anchor>' (or update the path/export)` repair command (D5, review U5).
 *   SYMBOL_MISSING_FOOTNOTE — the documented false-positive-forms footnote (D3),
 *     printed by CLI text rendering whenever any `symbol_missing` row appears.
 *
 * Side-effect class: IO (delegates entirely to the injected DriftFlowDeps + probe)
 * Source: SPEC-045 §Design Decisions D5, D7, D8
 */

import { ok } from "@lore/core";
import type { DocRecord, DriftRow, LoreError, Result } from "@lore/core";
import type { App } from "../app.js";
import type { DriftCheckResult, DriftCheckService, FsProbe } from "../service/drift-check-service.js";

/**
 * Narrow injected dependency bundle — mirrors `StalenessFlowDeps` (never the
 * full `App`). `runDrift` takes this directly, so a test can construct one from
 * plain fakes with no real store; {@link buildDriftFlowDeps} is a convenience
 * binder for real callers only.
 */
export interface DriftFlowDeps {
  /** Bind to `(probe) => app.driftCheckService.checkDrift(probe)`. */
  checkDrift: (probe: FsProbe) => Promise<Result<DriftCheckResult, LoreError>>;
  /** Bind to `() => app.corpusService.listFull({type: "spec"}).then((r) => (r.ok ? ok(r.value.docs) : r))`. */
  listSpecs: () => Promise<Result<DocRecord[], LoreError>>;
}

/**
 * Binds the "list every non-deleted spec" query alone — used both by
 * {@link buildDriftFlowDeps} (full deps, for `--check-drift`) and directly by
 * `countArmedSpecs` callers that need NO `DriftCheckService` at all (plain
 * `lore status`/`lore bootstrap`'s store-only declared-count line, D5).
 *
 * @param app - A wired `App` instance (CLI/MCP adapters only)
 */
export function buildListSpecs(app: App): () => Promise<Result<DocRecord[], LoreError>> {
  return () => app.corpusService.listFull({ type: "spec" }).then((r) => (r.ok ? ok(r.value.docs) : r));
}

/**
 * Convenience binder — builds a {@link DriftFlowDeps} bundle from a wired `App`
 * plus its (caller-resolved) `DriftCheckService`. Callers MUST guard
 * `app.driftCheckService === undefined` themselves BEFORE calling this (mirrors
 * `lore_bootstrap`'s `app.sessionService === undefined` guard) — passing the
 * already-narrowed, non-optional instance here keeps this binder simple and
 * throw-free, rather than duplicating the undefined check internally.
 *
 * @param app - A wired `App` instance (CLI/MCP adapters only)
 * @param driftCheckService - `app.driftCheckService`, already undefined-checked
 *   by the caller
 * @example
 * if (app.driftCheckService === undefined) { ...loud error...; return; }
 * const deps = buildDriftFlowDeps(app, app.driftCheckService);
 */
export function buildDriftFlowDeps(app: App, driftCheckService: DriftCheckService): DriftFlowDeps {
  return {
    checkDrift: (probe) => driftCheckService.checkDrift(probe),
    listSpecs: buildListSpecs(app),
  };
}

/** The `data.code_drift` / `lore_status`'s `code_drift` payload shape (D5, D7). */
export interface CodeDriftPayload {
  /** `true` iff at least one non-deleted spec OR knowledge doc declares ≥1 `code_anchors` entry. */
  armed: boolean;
  /** `false` when `workflow.drift.enabled` is `false` (D8) — no probing occurred. */
  enabled: boolean;
  /** `true` iff `drifts` is empty (armed:false OR enabled:false ⇒ always consistent, vacuously). */
  consistent: boolean;
  /** Count of SPECS that declare ≥1 code_anchors entry (review U7). */
  specs_checked: number;
  /**
   * Count of KNOWLEDGE docs that declare ≥1 code_anchors entry — the second scanned
   * population, reported separately so this payload can never imply it covered
   * knowledge when it did not.
   */
  knowledge_checked: number;
  /** The UNION of both scanned populations, broken down by doc status. */
  status_breakdown: Record<string, number>;
  /** Every anchor that failed to verify, deterministically sorted (doc_slug, then anchor — D5); each row self-attributes via `doc_type`. */
  drifts: DriftRow[];
}

/**
 * The `workflow.drift.enabled: false` LOUD-skip payload (D8) — a single
 * derivation site so the CLI (`commands/status.ts`) and MCP (`tools.ts`) never
 * hand-roll the same literal object twice. Returns a FRESH object each call
 * (never a shared mutable constant).
 */
export function disabledCodeDriftPayload(): CodeDriftPayload {
  return {
    armed: false,
    enabled: false,
    consistent: true,
    specs_checked: 0,
    knowledge_checked: 0,
    status_breakdown: {},
    drifts: [],
  };
}

/**
 * Deterministic drift-row ordering (D5) — sorted by `doc_slug`, then `anchor`, both
 * ascending lexicographic. Pure — does not mutate its input. A slug is unique corpus-
 * wide, so this stays a total order across both scanned doc types without needing
 * `doc_type` as a sort key.
 *
 * @param drifts - Unordered drift rows (e.g. `DriftCheckResult.drifts`, scan order)
 * @returns A NEW array, sorted.
 */
export function sortDrifts(drifts: readonly DriftRow[]): DriftRow[] {
  return [...drifts].sort((a, b) => {
    if (a.doc_slug !== b.doc_slug) return a.doc_slug < b.doc_slug ? -1 : 1;
    if (a.anchor !== b.anchor) return a.anchor < b.anchor ? -1 : 1;
    return 0;
  });
}

/**
 * Runs the doc-code drift scan (assumes `workflow.drift.enabled` is `true` —
 * callers check the config brake themselves and short-circuit to
 * {@link disabledCodeDriftPayload} when it is `false`, D8) and shapes the result
 * into the {@link CodeDriftPayload} BOTH CLI `--json` and MCP `lore_status` return
 * — the single derivation site (review S8).
 *
 * @param deps - See {@link DriftFlowDeps}
 * @param probe - Filesystem probe port, injected per call (D4) — see
 *   `adapters/real-fs-probe.ts::buildRealFsProbe` for the real implementation.
 * @returns `Result<CodeDriftPayload, LoreError>`
 */
export async function runDrift(deps: DriftFlowDeps, probe: FsProbe): Promise<Result<CodeDriftPayload, LoreError>> {
  const result = await deps.checkDrift(probe);
  if (!result.ok) return result;
  return ok({
    armed: result.value.armed,
    enabled: true,
    consistent: result.value.consistent,
    specs_checked: result.value.specs_checked,
    knowledge_checked: result.value.knowledge_checked,
    status_breakdown: result.value.status_breakdown,
    drifts: sortDrifts(result.value.drifts),
  });
}

/**
 * The literal `lore anchor rm` repair command for one drift row (D5, review U5)
 * — CLI text-rendering-only (the JSON payload's `DriftRow` carries no `fix`
 * field; MCP callers construct their own command from `doc_slug`/`anchor` if
 * they want one).
 *
 * @param row - One `DriftRow` from a `CodeDriftPayload.drifts` entry
 * @returns The literal repair command line
 * @example
 * renderDriftRepairHint({ spec_id: "x", doc_slug: "spec-foo", doc_type: "spec", spec_status: "approved", anchor: "src/a.ts#Foo", kind: "symbol_missing" });
 * // => "fix: lore anchor rm spec-foo 'src/a.ts#Foo' (or update the path/export)"
 */
export function renderDriftRepairHint(row: DriftRow): string {
  return `fix: lore anchor rm ${row.doc_slug} '${row.anchor}' (or update the path/export)`;
}

/**
 * The documented false-positive-forms footnote (D3) — printed by CLI text
 * rendering whenever a `symbol_missing` row appears, so a reader isn't misled
 * into thinking the scanner is a real TS parser.
 */
export const SYMBOL_MISSING_FOOTNOTE =
  "Note: the lexical export scanner does not recognize `export * from`, `module.exports`, " +
  "re-export chains, `export type { X }` (type-only brace lists), or destructured exports " +
  "(`export const {a, b} = obj`) — a symbol_missing row may be a false positive from one of these forms.";

/**
 * Store-only "N specs declare code_anchors" count (D5, D7 review U8) — ZERO
 * filesystem probing. This is a DECLARATION count (any spec whose stored
 * `extra.code_anchors` is a non-empty array), not a grammar-verified or
 * drift-verified count.
 *
 * ⛔ SPEC-SCOPED BY DECISION, and therefore NARROWER than
 * `DriftCheckResult.armed`: `--check-drift` also scans KNOWLEDGE docs
 * (`ANCHOR_SCANNED_DOC_TYPES`), so a corpus where only a knowledge doc declares
 * anchors reports `0` here while `checkDrift` reports `armed: true`. That is the
 * field's contract — its consumers (`lore status`'s `code_anchor_specs`, `lore
 * bootstrap`) name SPECS in their own output. Extending this count would silently
 * change the meaning of a published field; a knowledge-inclusive figure belongs in a
 * separately named one.
 *
 * @param listSpecs - See {@link DriftFlowDeps.listSpecs} / {@link buildListSpecs}
 * @returns `Result<number, LoreError>`
 * @example
 * const result = await countArmedSpecs(buildListSpecs(app));
 * if (result.ok && result.value > 0) console.log(`code anchors declared: ${result.value} specs`);
 */
export async function countArmedSpecs(
  listSpecs: () => Promise<Result<DocRecord[], LoreError>>,
): Promise<Result<number, LoreError>> {
  const specsResult = await listSpecs();
  if (!specsResult.ok) return specsResult;
  let count = 0;
  for (const doc of specsResult.value) {
    const raw = doc.extra["code_anchors"];
    if (Array.isArray(raw) && raw.length > 0) count++;
  }
  return ok(count);
}
